'use strict'

const spawn = require('child_process').spawn
const feed = require('feed-read')
const merge = require('lodash').merge
const subtitles = require('subtitler')
const retryPromise = require('promise-retry')
const fs = require('fs')
const gunzip = require('gunzip-maybe')
const http = require('http')
const slugify = require('slugify')
const tempfile = require('tempfile')
const path = require('path')
const shellEscape = require('shell-escape')
const utils = require('./utils')


module.exports = run


function run (options) {
  return (options.cache
    ? utils.createDir(options.cache)
    : Promise.resolve())
    .then(selectShow(options.feed, options.log))
    .then(downloadSubtitles(options.lang, options.cache, options.log))
    .then(streamTorrent(__dirname + '/node_modules/.bin/peerflix', options.cache, options.player, options.log))
}

function readFeed (rss) {
  return new Promise((resolve, reject) => feed(rss, (err, articles) => err ? reject(err) : resolve(articles)))
}

function searchSubtitles (title, cache, _skipReadCache) {
  if (cache && !_skipReadCache) {
    const results = utils.getOSResultsFromCache(cache, title)
    if (results) {
      return Promise.resolve(results)
    } else {
      return searchSubtitles(title, cache, true)
    }
  } else {
    return subtitles.api.login()
    .then(token => subtitles.api.searchForTitle(token, null, title)
      .then(results => ({
        token: token,
        results: results
      }))
    )
    .then(res => {
      if (cache) {
        utils.saveOSResultsToCache(cache, title, res.results)
      }
      subtitles.api.logout(res.token)
      return res.results
    })
  }
}

function selectShow (rss, log) {
  return () => readFeed(rss)
    .then(articles => utils.ask.list('Recent available episodes', articles.map(a => ({ name: a.title, value: {
      title: a.title,
      url: a.link
    }}))))
    .then(show => {
      log("Magnet URL: " + show.url)
      return show
    })
}

function downloadSubtitles (lang, cache, log) {
  return show => {
    const filename = cache ? path.join(cache, slugify(show.title) + '.srt') : tempfile('.srt')

    const searchAndDownload = () => utils.ask.confirm('Download subtitles?', true)
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

    const downloaded = utils.canRead(filename)
      ? utils.ask.confirm('Found previously downloaded subtitles, continue with it?', true)
        .then(reuse => reuse ? filename : searchAndDownload())
      : searchAndDownload()

    return downloaded
      .then(filename => merge({ subtitles: filename }, show))
      .catch(() => {
        log('OpenSubtitles seems to be grumpy today, I give up')
        return utils.ask.confirm('Continue without subtitles?', true)
        .then(cont => cont ? show : process.exit(1))
      })
  }
}

function downloadAs (filename, log) {
  return url => new Promise((resolve, reject) => {
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
}

function selectSubtitle (lang, log) {
  return allSubtitles => {
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

    return utils.ask.list('Available subtitles', subtitles.map(s => ({
      name: '[' + s.SubLanguageID + '] ' + s.SubFileName,
      value: s.SubDownloadLink
    })))
  }
}

function streamTorrent (peerflixBin, cache, player, log) {
  return show => new Promise((resolve, reject) => {
    const args = [show.url]
      .concat(cache ? ['--path', path.join(cache, 'download')] : [])
      .concat(show.subtitles ? ['--subtitles', show.subtitles] : [])
      .concat(player ? ['--' + player] : [])
    log('Running peerflix...')
    log(shellEscape([peerflixBin].concat(args)))
    const child = spawn(peerflixBin, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code ? reject(code) : resolve())
  })
}
