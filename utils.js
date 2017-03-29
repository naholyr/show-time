'use strict'

const mkdirp = require('mkdirp')
const { merge } = require('lodash')
const inquirer = require('inquirer')
const _slugify = require('slugify')
const fs = require('fs')
const path = require('path')
const tempfile = require('tempfile')
const glob = require('glob-promise')
const filesize = require('filesize')
const http = require('http')
const https = require('https')
const home = require('home')


module.exports = {
  createDir,
  ask,
  getCached,
  ifTrue,
  canRead,
  cachePath,
  dotPath,
  dirStats,
  biggestFile,
  fetch,
}


const slugify = string => _slugify(string.replace(/[\(\[\{\}\]\)]/g, ''))

function cachePath (cache, filename, fallbackTemp = false) {
  if (cache) {
    return path.join(cache, slugify(filename).replace(/['"]/g, ''))
  } else if (fallbackTemp) {
    return tempfile(path.extname(filename))
  } else {
    return null
  }
}

function dotPath (filename) {
  const homePath = home.resolve('~/.show-time')
  if (!canRead(homePath)) {
    mkdirp.sync(homePath)
  }
  return path.join(homePath, filename)
}

function createDir (dir) {
  return new Promise((resolve, reject) => mkdirp(dir, err => err ? reject(err) : resolve()))
}

function ask (question) {
  if (question.type === 'list') {
    // Append separator at end of list to mark end of list
    question = merge({}, question, {
      choices: question.choices.concat([new inquirer.Separator])
    })
  }

  return inquirer.prompt([merge({ name: 'answer' }, question)]).then(answers => answers.answer)
}

ask.confirm = function (message, def) {
  return ask({ type: 'confirm', message, default: def })
}

ask.list = function (message, choices, def) {
  return ask({ type: 'list', message, choices, default: def })
}

ask.input = function (message, def) {
  return ask({ type: 'input', message, default: def })
}

function getCached (cacheDir, filename, getData, { fallbackTemp = false, ttl = 86400, parse = JSON.parse, stringify = JSON.stringify } = {}) {
  const file = cachePath(cacheDir, filename, fallbackTemp)
  const freshData = () => Promise.resolve()
    .then(getData)
    .then(data => {
      if (file) {
        const buffer = stringify(data)
        fs.writeFileSync(file, buffer)
      }
      return data
    })

  // Cache disabled
  if (!file) {
    return freshData()
  }

  // No cache
  const stats = tryRun(() => fs.statSync(file))
  if (!stats) {
    return freshData()
  }

  // Cache expired
  const mtime = stats.mtime
  if (Date.now() - mtime > ttl * 1000) {
    return freshData()
  }

  // Get from cache
  return Promise.resolve(tryRun(() => parse(fs.readFileSync(file)), null))
}

function tryRun (fn, def) {
  try {
    return fn()
  } catch (e) {
    return def
  }
}

function ifTrue (fn) {
  return value => value && fn(value)
}

function canRead (filename) {
  try {
    fs.accessSync(filename, fs.R_OK)
    return true
  } catch (e) {
    return false
  }
}

function dirFiles (dir) {
  return glob(path.join(dir, '**'))
  .then(files => files.map(f => Object.assign(fs.statSync(f), { name: f })))
}

function dirStats (dir) {
  return dirFiles(dir)
  .then(files => ({
    count: files.length,
    size: files.reduce((s, f) => s + f.size, 0)
  }))
  .then(stats => Object.assign({
    hsize: filesize(stats.size)
  }, stats))
}

function biggestFile (dir) {
  return dirFiles(dir)
  .then(files => files.reduce((b, f) => b.size > f.size ? b : f))
}

function fetch (url) {
  const mod = url.match(/^https/) ? https : http
  return new Promise((resolve, reject) => {
    mod.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(Error('Unexpected response: ' + res.statusCode + ' - ' + res.statusMessage))
      }
      // read stream
      let content = new Buffer('')
      res.on('data', chunk => content = Buffer.concat([content, chunk]))
      res.on('error', reject)
      res.on('end', () => resolve(content))
    })
  })
}
