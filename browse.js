'use strict'

const http = require('http')
const search = require('cli-fuzzy-search')
const { getCached } = require('./utils')

const SHOWS_TTL = 86400
const URL = 'http://showrss.info/browse'
const FEED_URL = id => `https://showrss.info/show/${id}.rss`
const RE_SHOW = /<option value=["'](\d+)["'].*?>(.+?)<\/option>/
const RE_ALL = new RegExp(RE_SHOW, 'g')

// TODO cache previous choices to mark them as favorites and put them first

module.exports = ({ log, cache }) => {
  log('Fetch ' + URL + '…')
  return getCached(cache, 'shows.json', getData, { ttl: SHOWS_TTL })
    .then(data => search({ data }))
    .then(choice => choice && choice.feed)
}

const getData = () => fetch(URL).then(readStream).then(parseChoices)

const fetch = url => new Promise((resolve, reject) =>
  http.get(url, res =>
    res.statusCode === 200 ? resolve(res) : reject(Error('Unexpected response: ' + res.statusCode + ' - ' + res.statusMessage))
  )
)

const readStream = stream => new Promise((resolve, reject) => {
  let content = new Buffer('')
  stream.on('data', chunk => content = Buffer.concat([content, chunk]))
  stream.on('error', reject)
  stream.on('end', () => resolve(content))
})

const parseChoices = html => Promise.resolve().then(() => {
  html = html.toString('utf8')
  const options = html.match(RE_ALL)
  if (!options || options.length === 0) {
    throw new Error('No show found, an error may have occurred in HTML format')
  }
  return options
    .map(option => {
      const info = option.match(RE_SHOW)
      if (!info) {
        log('Parse error: show info not detected' + option)
        return null
      }
      const [ , id, label ] = info
      const feed = FEED_URL(id)
      return { label, feed }
    })
    .filter(choice => choice !== null)
})
