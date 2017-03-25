'use strict'

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

const SUBTITLES_TTL = 3600
const RE_TITLE_TOKENS = /720p|PROPER|REPACK/
const RE_TITLE_NUMBER = /[ \.-](\d{1,2})x(\d{1,2})(?:[ \.-]|$)/
const dedupeSubtitles = partialRight(uniqBy, 'SubDownloadLink')

module.exports = (options = {}) =>
  checkOptions(options)
  .then(opts =>
    cacheReady(opts) // void
    .then(selectEpisode(opts)) // { url, title }
    .then(downloadSubtitles(opts)) // { url, title, subtitles }
    .then(play(opts))
  )

const checkOptions = options => {
  const opts = Object.assign({}, options)
  opts.log = opts.log || console.log.bind(console)
  if (opts.browse) {
    if (opts.offline) {
      return Promise.reject(Error('Browse mode incompatible with offline mode'))
    }
    // Grab 'feed' option from browsing showrss
    return selectShow(opts.cache, opts.log).then(feed => Object.assign(opts, { feed }))
  }
  if (opts.offline && !opts.cache) {
    return Promise.reject(Error('Cannot use "offline" option while cache is disabled'))
  }
  return Promise.resolve(opts)
}

const cacheReady = ({ cache }) => cache ? utils.createDir(cache) : Promise.resolve()

const readFeed = rss => new Promise((resolve, reject) => feed(rss, (err, articles) => err ? reject(err) : resolve(articles)))

const pad0 = s => (s.length === 1) ? '0' + s : s

const fetchSubtitles = title => {
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

const searchSubtitles = (title, cache, _skipReadCache) => {
  const filename = title + '.json'
  const getData = () => fetchSubtitles(title)
  return utils.getCached(_skipReadCache ? null : cache, filename, getData, { ttl: SUBTITLES_TTL })
}

const selectEpisode = ({ feed, cache, offline, log }) => offline
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

const downloadSubtitles = ({ lang, cache, offline, log }) => show => {
  const filename = utils.cachePath(cache, show.title + '.srt', true)

  const searchAndDownload_off = () => {
    log('Subtitles download disabled in offline mode')
    return Promise.resolve()
  }
  const searchAndDownload_on = () => utils.ask.confirm('Download subtitles?', true)
    .then(utils.ifTrue(() => retryPromise(retry => {
      log('Searching subtitles...')
      return searchSubtitles(show.title, cache)
        .then(selectSubtitle(lang, log))
        .catch(err => {
          log('Failed looking up for subtitles, try again...')
          return retry(err)
        })
      }, { retries: 5 })
    ))
    .then(utils.ifTrue(downloadAs(filename, log)))
  const searchAndDownload = offline ? searchAndDownload_off : searchAndDownload_on

  const downloaded = utils.canRead(filename)
    ? utils.ask.confirm('Found previously downloaded subtitles, continue with it?', true)
      .then(reuse => reuse ? filename : searchAndDownload())
    : searchAndDownload()

  return downloaded
    .then(subtitles => Object.assign({}, show, { subtitles }))
    .catch(() => {
      log('OpenSubtitles seems to be grumpy today, I give up')
      return utils.ask.confirm('Continue without subtitles?', true)
      .then(cont => cont ? show : process.exit(1))
    })
}

const downloadAs = (filename, log) => url => new Promise((resolve, reject) => {
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

const selectSubtitle = (lang, log) => allSubtitles => {
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
    return null
  }

  // Sort by date desc
  const sortedSubtitles = subtitles.sort((s1, s2) => {
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
  const args = [show.url]
    .concat(offline ? [] : ['--peerflix-port', port || 8888, '--peerflix-peer-port', peerPort])
    .concat((offline || !cache) ? [] : ['--peerflix-path', utils.cachePath(cache, show.title)])
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
      const args = [show.url, '--port', port || 8888, '--peer-port', peerPort]
        .concat(cache ? ['--path', utils.cachePath(cache, show.title)] : [])
        .concat(show.subtitles ? ['--subtitles', show.subtitles] : [])
        .concat(player ? ['--' + player] : [])
      log('Running peerflix...')
      log(shellEscape([peerflixBin].concat(args)))
      const child = spawn(peerflixBin, args, { stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', code => code ? reject(code) : resolve())
    })
