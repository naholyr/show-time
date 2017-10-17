'use strict'

const search = require('cli-fuzzy-search')
const fuzzyFilter = require('cli-fuzzy-search/lib/fuzzy') // TODO use a public API should be better
const { dotPath, getCached, fetch, slugify } = require('./utils')
const { writeFileSync, readFileSync } = require('fs')
const { property } = require('lodash')
const chalk = require('chalk')

const SHOWS_TTL = 86400
const SEARCH_SIZE = 15
const URL = 'http://showrss.info/browse'
const FEED_URL = id => `https://showrss.info/show/${id}.rss`
const RE_SHOW = /<option value=["'](\d+)["'].*?>(.+?)<\/option>/
const RE_ALL = new RegExp(RE_SHOW, 'g')


module.exports = ({ cache, log, title }) => {
  log('Fetch ' + URL + '…')
  return getCached(cache, 'shows.json', fetchData(cache, log), { ttl: SHOWS_TTL })
    .then(prependSelected(cache))
    .then(data => ({
      data,
      size: SEARCH_SIZE
    }))
    .then(data => {
      if (title) {
        // Look for exact match
        const exact = data.data.filter(({label}) => sameTitle(label, title))
        if (exact.length === 1) {
          return exact[0]
        }
        // Look for same initials
        if (isInitials(title)) {
          const matchings = data.data.filter(({label}) => sameInitials(label, title))
          console.log(matchings)
          if (matchings.length === 1) {
            return matchings[0]
          }
        }
        const found = fuzzyFilter(data.data, [...title])
        if (found.length === 0) {
          log(chalk.red(`No occurrence found for "${title}", please search manually…`))
          return search(data)
        } else if (found.length === 1) {
          return found[0]
        } else {
          log(chalk.yellow(`Too many occurrences (${found.length}) found for "${title}", please search manually…`))
          return search(data)
        }
      } else {
        return search(data)
      }
    })
    .then(remember(cache))
    .then(property('feed'))
}

const fetchData = (cache, log) => () => fetch(URL).then(parseChoices(log))

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

const getSelected = () => {
  const file = dotPath('selected-shows.json')
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

const cleanTitle = title => slugify(title.toLowerCase())
const sameTitle = (title1, title2) => cleanTitle(title1) === cleanTitle(title2)

const isInitials = title => !!title.match(/^[a-zA-Z]+$/)
const getInitials = title => slugify(title).toUpperCase().split(/-/).map(s => s[0]).join('')
const sameInitials = (title, initials) => getInitials(title) === initials.toUpperCase()
