'use strict'

const { dirStats, ask } = require('./utils')
const chalk = require('chalk')
const rimraf = require('rimraf')
const { accessSync, R_WRITE } = require('fs')
const path = require('path')
const filesize = require('filesize')
const figures = require('figures')

module.exports = (cache, dryRun = false) =>
  dirStats(cache)
  .then(stats => {
    const downloads = stats.files.filter(f => f.isDirectory())
    const queryCacheNames = stats.files.filter(f => f.name.match(/\.json$/)).map(({ name }) => name)
    return Promise.all([ stats, downloads, dirStats(queryCacheNames) ])
  })
  .then(([ total, dls, queries ]) => ask.list('Select cache parts to delete', [
    { name: `Everything (${total.count} files, ${total.hsize})`,  value: [ 'delete', total.files ] },
    { name: `Query cache (${queries.count} files, ${queries.hsize})`, value: [ 'delete', queries.files ] },
    { name: `Select videos to be deleted (${dls.length} folders, ~${total.hsize})`,  value: [ 'select', dls ] },
  ]))
  .then(applyAction(dryRun))
  .then(v => {
    console.log(v)
    process.exit(0)
  })


const applyAction = dryRun => ([ action, files ]) =>
  Promise.all(files.map(f => dirStats(f.name)))
  .then(stats => {
    if (action === 'delete') {
      const padlength = stats.reduce((l, f) => Math.max(l, f.hsize.length), 0)
      const pad = padl(padlength)
      let total = files.reduce((sum, f, i) => {
        try {
          if (dryRun) {
            accessSync(f.name, R_WRITE)
          } else {
            rimraf.sync(f.name)
          }
          console.log(chalk.green(`${figures.tick} ${pad(stats[i].hsize)} ${f.name}`))
          return sum + stats[i].size
        } catch (e) {
          console.error(chalk.red(`${figures.cross} ${f.name}`))
          console.error(chalk.red(`  ${e.message}`))
          return sum
        }
      }, 0)
      console.log(chalk.bold(`Total: ${filesize(total)}`))
    } else if (action === 'select') {
      const choices = files.map((f, i) => ({
        name: `${path.basename(f.name)} (${stats[i].hsize})`,
        value: i,
        checked: true
      }))
      const status = choices => {
        const selected = choices.where({ checked: true })
        const sizes = selected.map(c => stats[c.value].size)
        const total = sizes.reduce((s, v) => s + v, 0)
        return `Freed space: ${filesize(total)}`
      }
      return ask.checkbox('Select videos to delete (default = all)', choices, status)
        .then(indices => [ 'delete', indices.map(i => files[i]) ])
        .then(applyAction(dryRun))
    }
  })

const padl = size => s => ' '.repeat(Math.max(0, size - s.length)) + s
