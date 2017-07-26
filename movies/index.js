'use strict'

// @flow

/*:: import type { Show } from '../types' */

const search = require('cli-fuzzy-search')

const engines = {
  yts: require('./yts')
}
const defaultEngine = 'yts'

// TODO cache
// TODO log

module.exports = ({ engine = defaultEngine } /*:{engine?:string}*/) /*:Promise<?Show>*/ =>
  search({ search: engines[engine] }) // { title, url }
  .then((movie /*:?{title:string, url:string,label:string}*/) => {
    if (!movie) {
      process.exit(0)
      return null
    }
    delete movie.label // required by cli-fuzzy-search
    return movie
  })
