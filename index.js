'use strict'
// @flow

/*:: import type { Options, Show, OrigSubtitles } from './types' */

const { spawn } = require('child_process')
const feed = require('feed-read')
const { flatten, partialRight, uniqBy } = require('lodash')
const subtitles = require('subtitler')
const retryPromise = require('promise-retry')
const fs = require('fs')
const gunzip = require('gunzip-maybe')
const http = require('http')
const shellEscape = require('shell-escape')
const utils = require('./utils')
const path = require('path')
const glob = require('glob-promise')
const playOffline = require('./play')
const selectShow = require('./browse')
const selectMovie = require('./movies')
const debug = require('debug')('show-time')
const levenshtein = require('levenshtein')
const qs = require('querystring')

const SUBTITLES_TTL = 3600
const RE_TITLE_TOKENS = /720p|PROPER|REPACK/
const RE_TITLE_NUMBER = /[ .-](\d{1,2})x(\d{1,2})(?:[ .-]|$)/
const dedupeSubtitles = partialRight(uniqBy, 'SubDownloadLink')

module.exports = (options/*:Options*/) /*:Promise<any>*/ =>
  checkOptions(options)
  .then(opts =>
    cacheReady(opts) // void
    .then(selectVideo(opts)) // { url, title }
    .then((video/*:?Show*/) => (debug('Selected (1/3)', video), video))
    .then(selectTorrent) // when url is an array of described torrents
    .then((torrent/*:?Show*/) => (debug('Selected (2/3)', torrent), torrent))
    .then(downloadSubtitles(opts)) // { url, title, subtitles }
    .then(show => (debug('Selected (3/3)', show), show))
    .then(play(opts))
  )

const checkOptions = options => {
  const opts = Object.assign({}, options)
  opts.log = opts.log || console.log.bind(console)
  if (opts.browse || opts.title) {
    if (opts.offline) {
      return Promise.reject(Error('Using option --browse or <title> is incompatible with offline mode'))
    }
    // Grab 'feed' option from browsing showrss
    return selectShow(opts).then(feed => {
      if (!feed) {
        process.exit(0)
      }
      return Object.assign(opts, { feed })
    })
  }
  if (opts.offline && !opts.cache) {
    return Promise.reject(Error('Cannot use "offline" option while cache is disabled'))
  }
  return Promise.resolve(opts)
}

const cacheReady = ({ cache }) => cache ? utils.createDir(cache) : Promise.resolve()

const readFeed = rss => new Promise((resolve, reject) => feed(rss, (err, articles) => err ? reject(err) : resolve(articles)))

const pad0 = s => (s.length === 1) ? '0' + s : s

const fetchSubtitles = (title/*:string*/) /*:Promise<OrigSubtitles[]>*/ => {
  // Cleanup title
  title = title.replace(RE_TITLE_TOKENS, '')
  const titles = [
    title.replace(RE_TITLE_NUMBER, (string, season, episode) => ` S${pad0(season)}E${pad0(episode)} `),
    title.replace(RE_TITLE_NUMBER, (string, season, episode) => ` ${pad0(season)}x${pad0(episode)} `)
  ]

  let token = null, results = null
  return subtitles.api.login()
    .then(_token => token = _token)
    .then(() => Promise.all(titles.map(t => subtitles.api.searchForTitle(token, null, t))))
    .then(flatten)
    .then(dedupeSubtitles)
    .then(_results => results = _results)
    .then(() => subtitles.api.logout(token))
    .then(() => results)
}

const searchSubtitles = (title, cache, _skipReadCache) /*:Promise<OrigSubtitles[]>*/ => {
  const filename = title + '.json'
  const getData = () => fetchSubtitles(title)
  return utils.getCached(_skipReadCache ? null : cache, filename, getData, { ttl: SUBTITLES_TTL })
}

const selectVideo = (opts) /*:() => Promise<?Show>*/ => opts.movie
  ? () => selectMovie(opts)
  : selectEpisode(opts)

const selectEpisode = ({ feed, cache, offline, log }) /*:() => Promise<Show>*/ => offline
  ? // Offline mode
    () => glob(path.join(cache, '*/'))
      .then(dirs => utils.ask.list('Partially or complete available episodes', dirs.map(d => ({
        name: path.basename(d),
        value: d
      }))))
      .then(dir => utils.biggestFile(dir).then(f => ({
        title: path.basename(dir),
        url: f.name
      })))
      .then(show => {
        log("File path: " + show.url)
        return show
      })
  : // Online
    () => readFeed(feed)
      .then(articles => utils.ask.list('Recent available episodes', articles.map(a => ({ name: a.title, value: {
        title: a.title,
        url: a.link
      }}))))
      .then(show => {
        log("Magnet URL: " + show.url)
        return show
      })

const selectTorrent = (show/*:?Show*/) /*:Promise<?Show>*/ => {
  if (!show || !Array.isArray(show.url)) {
    return Promise.resolve(show)
  }
  return _selectTorrent(show)
}

const _selectTorrent = (show/*:Show*/) /*:Promise<Show>*/ => {
  if (typeof show.url === 'string') {
    return Promise.resolve(show)
  }
  const urls = show.url.map(({ description, url }) => ({
    name: description,
    value: url
  }))
  return utils.ask.list('Select torrent', urls).then(url => {
    show.url = url
    return show
  })
}

/*$FlowFixMe*/
const downloadSubtitles = ({ lang, cache, offline, log }) => (show /*:?Show*/) /*:Promise<?Show>*/ => {
  if (!show) {
    return Promise.resolve(show)
  }

  const filename = utils.cachePath(cache, show.title + '.srt', true)

  if (!filename) {
    return Promise.reject(Error('Fallback to temporary dir failed'))
  }

  return _downloadSubtitles({ lang, cache, offline, log }, show, filename)
}

const _downloadSubtitles = ({ lang, cache, offline, log }, show/*:Show*/, filename/*:string*/) /*:Promise<Show>*/ => {
  const searchAndDownload_off = () => {
    log('Subtitles download disabled in offline mode')
    return Promise.resolve(null)
  }
  const searchAndDownload_on = () => utils.ask.confirm('Download subtitles?', true)
    .then(utils.ifTrue(() => retryPromise(retry => {
      log('Searching subtitles...')
      return searchSubtitles(show.title, cache)
        .then(selectSubtitle(lang, log, show))
        .catch(err => {
          debug('Subtitles Error', err)
          log('Failed looking up for subtitles, try again...')
          return retry(err)
        })
      }, { retries: 5 })
    ))
    .then(utils.ifTrue(downloadAs(filename, log)))
  const searchAndDownload /*:() => Promise<any>*/ = offline ? searchAndDownload_off : searchAndDownload_on

  const downloaded = (filename && utils.canRead(filename))
    ? utils.ask.confirm('Found previously downloaded subtitles, continue with it?', true)
      .then(reuse => reuse ? Promise.resolve(filename) : searchAndDownload(show))
    : searchAndDownload(show)

  const setSubtitles = (subtitles/*:?string*/) /*:Show*/ => {
    if (subtitles) {
      show.subtitles = subtitles
    }
    return show
  }

  return downloaded
    .then(setSubtitles)
    .catch(() => {
      log('OpenSubtitles seems to be grumpy today, I give up')
      return utils.ask.confirm('Continue without subtitles?', true)
      .then(cont => {
        if (!cont) {
          process.exit(1)
        }
        return show
      })
    })
}

/*$FlowFixMe*/
const downloadAs = (filename /*:string*/, log/*:Function*/) => (url/*:string*/) /*:Promise<string>*/ => new Promise((resolve, reject) => {
  log('Download: ' + url)
  log('To: ' + filename)
  http.get(url, res => {
    const output = fs.createWriteStream(filename)
    const uncompress = gunzip()
    res.on('error', reject)
    uncompress.on('error', reject)
    output.on('error', reject)
    output.on('close', () => resolve(filename))
    res.pipe(uncompress).pipe(output)
  }).on('error', reject)
})

const selectSubtitle = (lang/*:string*/, log/*:Function*/, show/*:?Show*/) => (allSubtitles/*:OrigSubtitles[]*/) /*:Promise<?string>*/ => {
  const langSubtitles = lang
    ? allSubtitles.filter(s => !lang || (s.SubLanguageID === lang))
    : allSubtitles

  const engSubtitles = allSubtitles.filter(s => !lang || (s.SubLanguageID === 'eng'))

  let subtitles = langSubtitles
  if (!subtitles.length) {
    if (lang !== 'eng') {
      log('No subtitles found for your preferred language "' + lang + '", fallback to English')
      subtitles = engSubtitles
      if (!subtitles.length) {
        log('Still no subtitle for English language, showing all subtitles')
        subtitles = allSubtitles
      }
    } else {
      log('No subtitles for English, showing all subtitles')
      subtitles = allSubtitles
    }
  }

  if (!subtitles.length) {
    log('No subtitles found')
    return Promise.resolve(null)
  }

  // Sort by similarity desc (= levenshtein asc), date desc
  const dn = show && qs.parse(show.url).dn // Use magnet's dn when possible (more info about releaser)
  const title = show ? dn || show.title : null
  debug('Reference title to sort subtitles', { show, title })
  const sortedSubtitles = subtitles.sort((s1, s2) => {
    if (show) {
      const l1 = levenshtein(title, s1.MovieReleaseName)
      const l2 = levenshtein(title, s2.MovieReleaseName)
      debug('Levenshtein', { title, s1: s1.MovieReleaseName, s2: s2.MovieReleaseName, l1, l2 })
      if (l1 !== l2) return l1 - l2;
      // else: fallback to date when title distance is the same
    }
    const d1 = new Date(s1.SubAddDate)
    const d2 = new Date(s2.SubAddDate)
    return (+d2) - (+d1)
  })

  return utils.ask.list('Available subtitles', sortedSubtitles.map(s => ({
    name: s.SubAddDate + ' [' + s.SubLanguageID + '] ' + s.SubFileName + ' (' + Math.round(s.SubSize / 1024) + 'Kb)',
    value: s.SubDownloadLink
  })))
}

const play = options => (options.player === 'chromecast')
  ? castNow(path.join(__dirname, 'node_modules', '.bin', 'castnow'), options.cache, options.offline, options.port, options['peer-port'], options.log)
  : streamTorrent(path.join(__dirname, 'node_modules', '.bin', 'peerflix'), options.cache, options.offline, options.player, options.port, options['peer-port'], options.log)

const castNow = (castnowBin, cache, offline, port, peerPort, log) => show => new Promise((resolve, reject) => {
  const cachePath = cache ? utils.cachePath(cache, show.title) : null
  const args/*:string[]*/ = [show.url]
    .concat(offline ? [] : ['--peerflix-port', String(port || 8888), '--peerflix-peer-port', String(peerPort)])
    .concat((offline || !cachePath) ? [] : ['--peerflix-path', cachePath])
    .concat(show.subtitles ? ['--subtitles', show.subtitles] : [])
  log('Running castnow...')
  log(shellEscape([castnowBin].concat(args)))
  const child = spawn(castnowBin, args, { stdio: 'inherit' })
  child.on('error', reject)
  child.on('exit', code => code ? reject(code) : resolve())
})

const streamTorrent = (peerflixBin, cache, offline, player, port, peerPort, log) => offline
  ? // Offline mode
    show => playOffline(player, show.url, show.subtitles)
  : // Online mode
    show => new Promise((resolve, reject) => {
      const cachePath = cache ? utils.cachePath(cache, show.title) : null
      const args/*:string[]*/ = [show.url, '--port', String(port || 8888), '--peer-port', String(peerPort)]
        .concat(cachePath ? ['--path', cachePath] : [])
        .concat(player && show.subtitles ? ['--subtitles', show.subtitles] : [])
        .concat(player ? ['--' + player] : [])
      log('Running peerflix...')
      log(shellEscape([peerflixBin].concat(args)))
      const child = spawn(peerflixBin, args, { stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', code => code ? reject(code) : resolve())
    })
