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

inquirer.registerPrompt('checkbox', require('inquirer-checkbox-status'))


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

ask.checkbox = function (message, choices, status) {
  return ask({ type: 'checkbox', message, choices, status })
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

const reduceConcat = arrays => arrays.reduce((result, array) => result.concat(array), [])

const fileStat = name => Object.assign(fs.statSync(name), { name })

function listFiles (files, withoutRoot = false) {
  if (Array.isArray(files)) {
    return Promise.all(files.map(f => listFiles(f))).then(reduceConcat) // array of arrays => array
  }

  const stat = fileStat(files)
  if (!stat.isDirectory()) {
    return Promise.resolve([stat])
  }

  return glob(path.join(files, '**'))
    .then(found => found.map(fileStat))
    .then(children => withoutRoot ? children.slice(1) : children)
}

function dirStats (dir) {
  return listFiles(dir, true).then(files => {
    const size = files.reduce((s, f) => s + f.size, 0)
    return {
      files: typeof dir === 'string'
        // Keep only "root" files
        ? files.filter(f => path.dirname(f.name) === dir)
        : files,
      count: files.length,
      size,
      hsize: filesize(size)
    }
  })
}

function biggestFile (dir) {
  return listFiles(dir)
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
