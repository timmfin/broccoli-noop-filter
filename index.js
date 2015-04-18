var fs = require('fs')
var path = require('path')
var mkdirp = require('mkdirp')
var Promise = require('rsvp').Promise
var quickTemp = require('quick-temp')
var helpers = require('broccoli-kitchen-sink-helpers')
var walkSync = require('walk-sync')
var mapSeries = require('promise-map-series')


module.exports = Filter
function Filter (inputTree, options) {
  if (!inputTree) {
    throw new Error('broccoli-noop-filter must be passed an inputTree, instead it received `undefined`');
  }
  this.inputTree = inputTree
  options = options || {}
  if (options.extensions != null) this.extensions = options.extensions
  if (options.targetExtension != null) this.targetExtension = options.targetExtension
  if (options.inputEncoding !== undefined) this.inputEncoding = options.inputEncoding
}

Filter.prototype.rebuild = function () {
  var self = this

  var paths = walkSync(this.inputPath)
    return mapSeries(paths, function (relativePath) {
      if (relativePath.slice(-1) !== '/') {
        if (self.canProcessFile(relativePath)) {
          return self.processAndCacheFile(self.inputPath, relativePath)
        }
      }
    })
}

// Compatibility with Broccoli < 0.14
// See https://github.com/broccolijs/broccoli/blob/master/docs/new-rebuild-api.md
Filter.prototype.read = function (readTree) {
  var self = this

  this.needsCleanup = true

  return readTree(this.inputTree)
    .then(function (inputPath) {
      self.inputPath = inputPath
      return self.rebuild()
    })
    .then(function () {
      return self.inputPath
    })
}

Filter.prototype.cleanup = function () {}

Filter.prototype.canProcessFile = function (relativePath) {
  return this.getDestFilePath(relativePath) != null
}

Filter.prototype.getDestFilePath = function (relativePath) {
  for (var i = 0; i < this.extensions.length; i++) {
    var ext = this.extensions[i]
    if (relativePath.slice(-ext.length - 1) === '.' + ext) {
      if (this.targetExtension != null) {
        relativePath = relativePath.slice(0, -ext.length) + this.targetExtension
      }
      return relativePath
    }
  }
  return null
}

// To do: Get rid of the srcDir/destDir args because we now have inputPath/outputPath
// https://github.com/search?q=processAndCacheFile&type=Code&utf8=%E2%9C%93

Filter.prototype.processAndCacheFile = function (srcDir, relativePath) {
  var self = this

  this._cache = this._cache || {}
  this._cacheIndex = this._cacheIndex || 0
  var cacheEntry = this._cache[relativePath]
  if (cacheEntry != null && cacheEntry.hash === hash(cacheEntry.inputFiles)) {
    // Do nothing
  } else {
    return Promise.resolve()
      .then(function () {
        return self.processFile(srcDir, relativePath)
      })
      .catch(function (err) {
        // Augment for helpful error reporting
        err.broccoliInfo = err.broccoliInfo || {}
        err.broccoliInfo.file = path.join(srcDir, relativePath)
        // Compatibility
        if (err.line != null) err.broccoliInfo.firstLine = err.line
        if (err.column != null) err.broccoliInfo.firstColumn = err.column
        throw err
      })
  }

  function hash (filePaths) {
    return filePaths.map(function (filePath) {
      return helpers.hashTree(srcDir + '/' + filePath)
    }).join(',')
  }
}

Filter.prototype.processFile = function (srcDir, relativePath) {
  var self = this
  var inputEncoding = (this.inputEncoding === undefined) ? 'utf8' : this.inputEncoding
  var string = fs.readFileSync(srcDir + '/' + relativePath, { encoding: inputEncoding })
  return Promise.resolve(self.processString(string, relativePath))
}
