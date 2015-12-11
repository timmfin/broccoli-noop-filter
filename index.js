var fs = require('fs')
var path = require('path')
var rimraf = require('rimraf').sync
var mkdirp = require('mkdirp')
var Plugin = require('broccoli-plugin');
var Promise = require('rsvp').Promise
var quickTemp = require('quick-temp')
var helpers = require('broccoli-kitchen-sink-helpers')
var walkSync = require('walk-sync')
var mapSeries = require('promise-map-series')
var symlinkOrCopy = require('symlink-or-copy').sync


module.exports = NoOpFilter
NoOpFilter.prototype = Object.create(Plugin.prototype);
NoOpFilter.constructor = NoOpFilter;

function NoOpFilter (inputTree, options) {
  if (!inputTree) {
    throw new Error('broccoli-noop-filter must be passed an inputTree, instead it received `undefined`');
  }
  this.inputTree = inputTree
  options = options || {}
  if (options.extensions != null) this.extensions = options.extensions
  if (options.targetExtension != null) this.targetExtension = options.targetExtension
  if (options.inputEncoding !== undefined) this.inputEncoding = options.inputEncoding
  if (typeof options.onCachedFile == "function") this.onCachedFile = options.onCachedFile

  this.needToSymlinkInputToOutput = true;
}

NoOpFilter.prototype.build = function () {
  var self = this
  var paths = walkSync(this.inputPath)

  // Need to symlink the input to the output, but only have to do it once
  // (with broccoli-plugin, can no longer simply return this.inputPath at the
  // end of the rebuild)
  if (this.needToSymlinkInputToOutput) {
    rimraf(this.outputPath);
    symlinkOrCopy(this.inputPath, this.outputPath);
    this.needToSymlinkInputToOutput = false;
  }

  return mapSeries(paths, function (relativePath) {
    if (relativePath.slice(-1) !== '/') {
      if (self.canProcessFile(relativePath)) {
        return self.processAndCacheFile(self.inputPath, relativePath)
      }
    }
  })
}

NoOpFilter.prototype.canProcessFile = function (relativePath) {
  return this.getDestFilePath(relativePath) != null
}

NoOpFilter.prototype.getDestFilePath = function (relativePath) {
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

NoOpFilter.prototype.processAndCacheFile = function (srcDir, relativePath) {
  var self = this

  this._cache = this._cache || {}
  this._cacheIndex = this._cacheIndex || 0
  var cacheEntry = this._cache[relativePath]
  if (cacheEntry != null && cacheEntry.hash === hash(cacheEntry.inputFiles)) {
    // Do nothing unless a custom cache func has been set
    if (self.onCachedFile) self.onCachedFile(srcDir, relativePath);
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
      .then(function (cacheInfo) {
        copyToCache(cacheInfo)
      })
  }

  function hash (filePaths) {
    return filePaths.map(function (filePath) {
      return helpers.hashTree(srcDir + '/' + filePath)
    }).join(',')
  }

  function copyToCache (cacheInfo) {
    var cacheEntry = {
      inputFiles: (cacheInfo || {}).inputFiles || [relativePath],
      outputFiles: (cacheInfo || {}).outputFiles || [self.getDestFilePath(relativePath)],
      cacheFiles: []
    }
    cacheEntry.hash = hash(cacheEntry.inputFiles)
    self._cache[relativePath] = cacheEntry
  }
}

NoOpFilter.prototype.processFile = function (srcDir, relativePath) {
  var self = this
  var inputEncoding = (this.inputEncoding === undefined) ? 'utf8' : this.inputEncoding
  var string = fs.readFileSync(srcDir + '/' + relativePath, { encoding: inputEncoding })
  return Promise.resolve(self.processString(string, relativePath))
}
