'use strict'

const errnos = Object.assign({}, require('errno').errno, {
  // Add some unrecognized errors
  EAI_AGAIN: {
    description: 'Domain name resolution failed, check your connection and try again'
  }
})

exports.getMessage = err => {
  let str = ''

  // if it's a libuv error then get the description from errno
  if (errnos[err.errno]) {
    str += errnos[err.errno].description
  } else {
    str += err.message
  }

  // if it's a `fs` error then it'll have a 'path' property
  if (err.path) {
    str += ' [' + err.path + ']'
  }

  return str
}
