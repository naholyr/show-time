'use strict'

const search = require('cli-fuzzy-search')

const engines = {
  yts: require('./yts')
}
const defaultEngine = 'yts'

// TODO cache
// TODO log

module.exports = ({ engine = defaultEngine }) =>
  search({ search: engines[engine] }) // { title, url }
  .then(movie => {
    if (!movie) {
      process.exit(0)
    }
    return { title: movie.title, url: movie.url }
  })
