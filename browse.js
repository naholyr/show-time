'use strict'

const http = require('http')
const search = require('cli-fuzzy-search')
const { cachePath, getCached } = require('./utils')
const { writeFileSync, readFileSync } = require('fs')
const { property } = require('lodash')

const SHOWS_TTL = 86400
const SEARCH_SIZE = 15
const URL = 'http://showrss.info/browse'
const FEED_URL = id => `https://showrss.info/show/${id}.rss`
const RE_SHOW = /<option value=["'](\d+)["'].*?>(.+?)<\/option>/
const RE_ALL = new RegExp(RE_SHOW, 'g')


module.exports = (cache, log) => {
  log('Fetch ' + URL + '…')
  return getCached(cache, 'shows.json', fetchData(cache, log), { ttl: SHOWS_TTL })
    .then(prependSelected(cache))
    .then(data => ({
      data,
      size: SEARCH_SIZE
    }))
    .then(search)
    .then(remember(cache))
    .then(property('feed'))
}

const fetchData = (cache, log) => () =>
  fetch(URL)
  .then(readStream)
  .then(parseChoices(log))

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

const parseChoices = log => html => Promise.resolve().then(() => {
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

const prependSelected = cache => choices => {
  const { data } = getSelected(cache)
  const otherChoices = choices
    // Remove favorites from global list (dedupe)
    .filter(choice => !data.some(isSameShow(choice)))
  return data
    // Keep only selected shows that actually exist in choices
    .filter(show => choices.some(isSameShow(show)))
    .concat(otherChoices)
}

const getSelected = cache => {
  const file = cachePath(cache, 'selected-shows.json')
  if (!file) {
    return { file, data: [] }
  }
  try {
    return { file, data: JSON.parse(readFileSync(file)) }
  } catch (e) {
    return { file, data: [] }
  }
}

const remember = cache => choice => {
  if (choice && cache) {
    const { file, data } = getSelected(cache)
    // Shift choice back to top (if it was already in list, otherwise just add it)
    const newData = [ choice ].concat(data.filter(isDifferentShow(choice)))
    writeFileSync(file, JSON.stringify(newData))
  }
  return choice
}

const isSameShow = show1 => show2 => show1.feed === show2.feed && show1.label === show2.label
const isDifferentShow = show1 => show2 => show1.feed !== show2.feed || show1.label !== show2.label
