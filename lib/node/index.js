
/**
 * Module dependencies.
 */

var debug = require('debug')('superagent');
var formidable = require('formidable');
var FormData = require('form-data');
var Response = require('./response');
var parse = require('url').parse;
var format = require('url').format;
var methods = require('methods');
var Stream = require('stream');
var utils = require('./utils');
var extend = require('extend');
var Part = require('./part');
var mime = require('mime');
var https = require('https');
var http = require('http');
var fs = require('fs');
var qs = require('qs');
var zlib = require('zlib');
var util = require('util');
var pkg = require('../../package.json');

/**
 * Expose the request function.
 */

exports = module.exports = request;

/**
 * Expose the agent function
 */

exports.agent = require('./agent');

/**
 * Expose `Part`.
 */

exports.Part = Part;

/**
 * Noop.
 */

function noop(){};

/**
 * Expose `Response`.
 */

exports.Response = Response;

/**
 * Define "form" mime type.
 */

mime.define({
  'application/x-www-form-urlencoded': ['form', 'urlencoded', 'form-data']
});

/**
 * Protocol map.
 */

exports.protocols = {
  'http:': http,
  'https:': https
};

/**
 * Check if `obj` is an object.
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isObject(obj) {
  return null != obj && 'object' == typeof obj;
}

/**
 * Default serialization map.
 *
 *     superagent.serialize['application/xml'] = function(obj){
 *       return 'generated xml here';
 *     };
 *
 */

exports.serialize = {
  'application/x-www-form-urlencoded': qs.stringify,
  'application/json': JSON.stringify
};

/**
 * Default parsers.
 *
 *     superagent.parse['application/xml'] = function(res, fn){
 *       fn(null, result);
 *     };
 *
 */

exports.parse = require('./parsers');

/**
 * Initialize a new `Request` with the given `method` and `url`.
 *
 * @param {String} method
 * @param {String|Object} url
 * @api public
 */

function Request(method, url) {
  Stream.call(this);
  var self = this;
  if ('string' != typeof url) url = format(url);
  this._agent = false;
  this._formData = null;
  this.method = method;
  this.url = url;
  this.header = {};
  this.writable = true;
  this._redirects = 0;
  this.redirects(5);
  this.cookies = '';
  this.qs = {};
  this._redirectList = [];
  this.on('end', this.clearTimeout.bind(this));
  this.on('response', function(res){
    self.callback(null, res);
  });
}

/**
 * Inherit from `Stream`.
 */

util.inherits(Request, Stream);

/**
 * Write the field `name` and `val` for "multipart/form-data"
 * request bodies.
 *
 * ``` js
 * request.post('http://localhost/upload')
 *   .field('foo', 'bar')
 *   .end(callback);
 * ```
 *
 * @param {String} name
 * @param {String|Buffer|fs.ReadStream} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.field = function(name, val){
  debug('field', name, val);
  if (!this._formData) this._formData = new FormData();
  this._formData.append(name, val);
  return this;
};

/**
 * Queue the given `file` as an attachment to the specified `field`,
 * with optional `filename`.
 *
 * ``` js
 * request.post('http://localhost/upload')
 *   .attach(new Buffer('<b>Hello world</b>'), 'hello.html')
 *   .end(callback);
 * ```
 *
 * A filename may also be used:
 *
 * ``` js
 * request.post('http://localhost/upload')
 *   .attach('files', 'image.jpg')
 *   .end(callback);
 * ```
 *
 * @param {String} field
 * @param {String|fs.ReadStream|Buffer} file
 * @param {String} filename
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.attach = function(field, file, filename){
  if (!this._formData) this._formData = new FormData();
  if ('string' == typeof file) {
    filename = file;
    debug('creating `fs.ReadStream` instance for file: %s', filename);
    file = fs.createReadStream(filename);
  }
  this._formData.append(field, file, filename);
  return this;
};

/**
 * Set the max redirects to `n`.
 *
 * @param {Number} n
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.redirects = function(n){
  debug('max redirects %s', n);
  this._maxRedirects = n;
  return this;
};

/**
 * Return a new `Part` for this request.
 *
 * @return {Part}
 * @api public
 * @deprecated pass a readable stream in to `Request#attach()` instead
 */

Request.prototype.part = util.deprecate(function(){
  return new Part(this);
}, '`Request#part()` is deprecated. ' +
   'Pass a readable stream in to `Request#attach()` instead.');

/**
 * Gets/sets the `Agent` to use for this HTTP request. The default (if this
 * function is not called) is to opt out of connection pooling (`agent: false`).
 *
 * @param {http.Agent} agent
 * @return {http.Agent}
 * @api public
 */

Request.prototype.agent = function(agent){
  if (agent) this._agent = agent;
  return this._agent;
};

/**
 * Set header `field` to `val`, or multiple fields with one object.
 *
 * Examples:
 *
 *      req.get('/')
 *        .set('Accept', 'application/json')
 *        .set('X-API-Key', 'foobar')
 *        .end(callback);
 *
 *      req.get('/')
 *        .set({ Accept: 'application/json', 'X-API-Key': 'foobar' })
 *        .end(callback);
 *
 * @param {String|Object} field
 * @param {String} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.set = function(field, val){
  if (isObject(field)) {
    for (var key in field) {
      this.set(key, field[key]);
    }
    return this;
  }

  debug('set %s "%s"', field, val);
  this.request().setHeader(field, val);
  return this;
};

/**
 * Remove header `field`.
 *
 * Example:
 *
 *      req.get('/')
 *        .unset('User-Agent')
 *        .end(callback);
 *
 * @param {String} field
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.unset = function(field){
  debug('unset %s', field);
  this.request().removeHeader(field);
  return this;
};

/**
 * Get request header `field`.
 *
 * @param {String} field
 * @return {String}
 * @api public
 */

Request.prototype.get = function(field){
  return this.request().getHeader(field);
};

/**
 * Set _Content-Type_ response header passed through `mime.lookup()`.
 *
 * Examples:
 *
 *      request.post('/')
 *        .type('xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('json')
 *        .send(jsonstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('application/json')
 *        .send(jsonstring)
 *        .end(callback);
 *
 * @param {String} type
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.type = function(type){
  return this.set('Content-Type', ~type.indexOf('/')
    ? type
    : mime.lookup(type));
};

/**
 * Set _Accept_ response header passed through `mime.lookup()`.
 *
 * Examples:
 *
 *      superagent.types.json = 'application/json';
 *
 *      request.get('/agent')
 *        .accept('json')
 *        .end(callback);
 *
 *      request.get('/agent')
 *        .accept('application/json')
 *        .end(callback);
 *
 * @param {String} accept
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.accept = function(type){
  return this.set('Accept', ~type.indexOf('/')
    ? type
    : mime.lookup(type));
};

/**
 * Add query-string `val`.
 *
 * Examples:
 *
 *   request.get('/shoes')
 *     .query('size=10')
 *     .query({ color: 'blue' })
 *
 * @param {Object|String} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.query = function(val){
  var obj = {};

  if ('string' == typeof val) {
    var elements = val.split('&');
    for (var i = 0; i < elements.length; i++) {
      var parts = elements[i].split('=');
      obj[parts[0]] = parts[1];
    }
    return this.query(obj);
  }

  extend(this.qs, val);
  return this;
};

/**
 * Send `data`, defaulting the `.type()` to "json" when
 * an object is given.
 *
 * Examples:
 *
 *       // manual json
 *       request.post('/user')
 *         .type('json')
 *         .send('{"name":"tj"}')
 *         .end(callback)
 *
 *       // auto json
 *       request.post('/user')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // manual x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send('name=tj')
 *         .end(callback)
 *
 *       // auto x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // string defaults to x-www-form-urlencoded
 *       request.post('/user')
 *         .send('name=tj')
 *         .send('foo=bar')
 *         .send('bar=baz')
 *         .end(callback)
 *
 * @param {String|Object} data
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.send = function(data){
  var obj = isObject(data);
  var req = this.request();
  var type = req.getHeader('Content-Type');

  // merge
  if (obj && isObject(this._data)) {
    for (var key in data) {
      this._data[key] = data[key];
    }
  // string
  } else if ('string' == typeof data) {
    // default to x-www-form-urlencoded
    if (!type) this.type('form');
    type = req.getHeader('Content-Type');

    // concat &
    if ('application/x-www-form-urlencoded' == type) {
      this._data = this._data
        ? this._data + '&' + data
        : data;
    } else {
      this._data = (this._data || '') + data;
    }
  } else {
    this._data = data;
  }

  if (!obj) return this;

  // default to json
  if (!type) this.type('json');
  return this;
};

/**
 * Write raw `data` / `encoding` to the socket.
 *
 * @param {Buffer|String} data
 * @param {String} encoding
 * @return {Boolean}
 * @api public
 */

Request.prototype.write = function(data, encoding){
  return this.request().write(data, encoding);
};

/**
 * Pipe the request body to `stream`.
 *
 * @param {Stream} stream
 * @param {Object} options
 * @return {Stream}
 * @api public
 */

Request.prototype.pipe = function(stream, options){
  this.piped = true; // HACK...
  this.buffer(false);
  this.end().req.on('response', function(res){
    if (/^(deflate|gzip)$/.test(res.headers['content-encoding'])) {
      res.pipe(zlib.createUnzip()).pipe(stream, options);
    } else {
      res.pipe(stream, options);
    }
  });
  return stream;
};

/**
 * Enable / disable buffering.
 *
 * @return {Boolean} [val]
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.buffer = function(val){
  this._buffer = false === val
    ? false
    : true;
  return this;
};

/**
 * Set timeout to `ms`.
 *
 * @param {Number} ms
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.timeout = function(ms){
  this._timeout = ms;
  return this;
};

/**
 * Clear previous timeout.
 *
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.clearTimeout = function(){
  debug('clear timeout %s %s', this.method, this.url);
  this._timeout = 0;
  clearTimeout(this._timer);
  return this;
};

/**
 * Abort and clear timeout.
 *
 * @api public
 */

Request.prototype.abort = function(){
  debug('abort %s %s', this.method, this.url);
  this._aborted = true;
  this.clearTimeout();
  this.req.abort();
};

/**
 * Define the parser to be used for this response.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.parse = function(fn){
  this._parser = fn;
  return this;
};

/**
 * Redirect to `url
 *
 * @param {IncomingMessage} res
 * @return {Request} for chaining
 * @api private
 */

Request.prototype.redirect = function(res){
  var url = res.headers.location;
  debug('redirect %s -> %s', this.url, url);

  // location
  if (!~url.indexOf('://')) {
    if (0 != url.indexOf('//')) {
      url = '//' + this.host + url;
    }
    url = this.protocol + url;
  }

  // ensure the response is being consumed
  // this is required for Node v0.10+
  res.resume();

  // strip Content-* related fields
  // in case of POST etc
  var header = utils.cleanHeader(this.req._headers);
  delete this.req;

  // force GET
  this.method = 'HEAD' == this.method
    ? 'HEAD'
    : 'GET';

  // redirect
  this._data = null;
  this.url = url;
  this._redirectList.push(url);
  this.clearTimeout();
  this.emit('redirect', res);
  this.set(header);
  this.end(this._callback);
  return this;
};

/**
 * Set Authorization field value with `user` and `pass`.
 *
 * @param {String} user
 * @param {String} pass
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.auth = function(user, pass){
  if (pass) pass = ':' + pass;
  var str = new Buffer(user + (pass || '')).toString('base64');
  return this.set('Authorization', 'Basic ' + str);
};

/**
 * Set the certificate authority option for https request.
 *
 * @param {Buffer | Array} cert
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.ca = function(cert){
  this._ca = cert;
  return this;
};

/**
 * Control whether invalid server certificates should
 * be rejected (default) or not.
 * @param {Boolean} val
 * @return {Request} for chaining
 * @api public
 */
Request.prototype.rejectUnauthorized = function (val) {
  this.rejectUnauthorized = val;
  return this;
};

/**
 * Sets the client's ssl key.
 * @param val ssl key buffer
 * @return {Request} for chaining
 * @api public
 */
Request.prototype.setSSLKey = function (val) {
  this.sslKey = val;
  return this;
};

/**
 * Sets the client's ssl certificate.
 * @param val ssl certificate buffer
 * @return {Request} for chaining
 * @api public
 */
Request.prototype.setSSLCert = function (val){
  this.sslCert = val;
  return this;
};

/**
 * Return an http[s] request.
 *
 * @return {OutgoingMessage}
 * @api private
 */

Request.prototype.request = function(){
  if (this.req) return this.req;

  var self = this;
  var options = {};
  var data = this._data;
  var url = this.url;

  // default to http://
  if (0 != url.indexOf('http')) url = 'http://' + url;
  url = parse(url, true);

  // options
  options.method = this.method;
  options.port = url.port;
  options.path = url.pathname;
  options.host = url.hostname;
  options.ca = this._ca;
  options.agent = this._agent;

  if (this.rejectUnauthorized !== undefined) {
    options.rejectUnauthorized = this.rejectUnauthorized;
  }

  if (this.sslCert !== undefined) {
    options.cert = this.sslCert;
  }
    
  if (this.sslKey !== undefined) {
     options.key = this.sslKey;
  }

  // initiate request
  var mod = exports.protocols[url.protocol];

  // request
  var req = this.req = mod.request(options);
  if ('HEAD' != options.method) req.setHeader('Accept-Encoding', 'gzip, deflate');
  this.protocol = url.protocol;
  this.host = url.host;

  // expose events
  req.on('drain', function(){ self.emit('drain'); });

  req.on('error', function(err){
    // flag abortion here for out timeouts
    // because node will emit a faux-error "socket hang up"
    // when request is aborted before a connection is made
    if (self._aborted) return;
    self.callback(err);
  });

  // auth
  if (url.auth) {
    var auth = url.auth.split(':');
    this.auth(auth[0], auth[1]);
  }

  // query
  this.query(url.query);

  // add cookies
  req.setHeader('Cookie', this.cookies);

  // set default UA
  req.setHeader('User-Agent', 'node-superagent/' + pkg.version);

  return req;
};

/**
 * Invoke the callback with `err` and `res`
 * and handle arity check.
 *
 * @param {Error} err
 * @param {Response} res
 * @api private
 */

Request.prototype.callback = function(err, res){
  var fn = this._callback;
  this.clearTimeout();
  
  if (this.called) {
    console.warn('superagent callback invoked twice!', new Error('double callback'));
    return;
  }

  this.called = true;
  if (2 == fn.length) return fn(err, res);
  if (err) return this.emit('error', err);
  fn(res);
};

/**
 * Initiate request, invoking callback `fn(err, res)`
 * with an instanceof `Response`.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.end = function(fn){
  var self = this;
  var data = this._data;
  var req = this.request();
  var buffer = this._buffer;
  var method = this.method;
  var timeout = this._timeout;
  debug('%s %s', this.method, this.url);

  // store callback
  this._callback = fn || noop;

  // querystring
  try {
    var querystring = qs.stringify(this.qs);
    req.path += querystring.length
      ? (~req.path.indexOf('?') ? '&' : '?') + querystring
      : '';
  } catch (e) {
    return this.callback(e);
  }

  // timeout
  if (timeout && !this._timer) {
    debug('timeout %sms %s %s', timeout, this.method, this.url);
    this._timer = setTimeout(function(){
      var err = new Error('timeout of ' + timeout + 'ms exceeded');
      err.timeout = timeout;
      self.abort();
      self.callback(err);
    }, timeout);
  }

  // body
  if ('HEAD' != method && !req._headerSent) {
    // serialize stuff
    if ('string' != typeof data) {
      var contentType = req.getHeader('Content-Type')
      // Parse out just the content type from the header (ignore the charset)
      if (contentType) contentType = contentType.split(';')[0]
      var serialize = exports.serialize[contentType];
      if (serialize) data = serialize(data);
    }

    // content-length
    if (data && !req.getHeader('Content-Length')) {
      this.set('Content-Length', Buffer.byteLength(data));
    }
  }

  // response
  req.on('response', function(res){
    debug('%s %s -> %s', self.method, self.url, res.statusCode);
    var max = self._maxRedirects;
    var mime = utils.type(res.headers['content-type'] || '');
    var len = res.headers['content-length'];
    var type = mime.split('/');
    var subtype = type[1];
    var type = type[0];
    var multipart = 'multipart' == type;
    var redirect = isRedirect(res.statusCode);

    if (self.piped) {
      res.on('end', function(){
        self.emit('end');
      });
      return;
    }

    // redirect
    if (redirect && self._redirects++ != max) {
      return self.redirect(res);
    }

    // zlib support
    if (/^(deflate|gzip)$/.test(res.headers['content-encoding'])) {
      utils.unzip(req, res);
    }

    // don't buffer multipart
    if (multipart) buffer = false;

    // TODO: make all parsers take callbacks
    if (multipart) {
      var form = new formidable.IncomingForm;

      form.parse(res, function(err, fields, files){
        if (err) return self.callback(err);
        var response = new Response(req, res);
        response.body = fields;
        response.files = files;
        response.redirects = self._redirectList;
        self.emit('end');
        self.callback(null, response);
      });
      return;
    }

    // by default only buffer text/*, json
    // and messed up thing from hell
    var text = isText(mime);
    if (null == buffer && text) buffer = true;

    // parser
    var parse = 'text' == type
      ? exports.parse.text
      : exports.parse[mime];

    // buffered response
    if (buffer) parse = parse || exports.parse.text;

    // explicit parser
    if (self._parser) parse = self._parser;

    // parse
    if (parse) {
      parse(res, function(err, obj){
        // TODO: handle error
        res.body = obj;
      });
    }

    // unbuffered
    if (!buffer) {
      debug('unbuffered %s %s', self.method, self.url);
      self.res = res;
      var response = new Response(self.req, self.res);
      response.redirects = self._redirectList;
      self.emit('response', response);
      if (multipart) return // allow multipart to handle end event
      res.on('end', function(){
        debug('end %s %s', self.method, self.url);
        self.emit('end');
      })
      return;
    }

    // end event
    self.res = res;
    res.on('end', function(){
      debug('end %s %s', self.method, self.url);
      // TODO: unless buffering emit earlier to stream
      var response = new Response(self.req, self.res);
      response.redirects = self._redirectList;
      self.emit('response', response);
      self.emit('end');
    });
  });

  this.emit('request', this);

  // if a FormData instance got created, then we send that as the request body
  var formData = this._formData;
  if (formData) {

    // set headers
    var headers = formData.getHeaders();
    for (var i in headers) {
      debug('setting FormData header: "%s: %s"', i, headers[i]);
      req.setHeader(i, headers[i]);
    }

    // attempt to get "Content-Length" header
    formData.getLength(function(err, length) {
      // TODO: Add chunked encoding when no length (if err)

      debug('got FormData Content-Length: %s', length);
      if ('number' == typeof length) {
        req.setHeader('Content-Length', length);
      }

      formData.pipe(req);
    });
  } else {
    req.end(data);
  }

  return this;
};

/**
 * Expose `Request`.
 */

exports.Request = Request;

/**
 * Issue a request:
 *
 * Examples:
 *
 *    request('GET', '/users').end(callback)
 *    request('/users').end(callback)
 *    request('/users', callback)
 *
 * @param {String} method
 * @param {String|Function} url or callback
 * @return {Request}
 * @api public
 */

function request(method, url) {
  // callback
  if ('function' == typeof url) {
    return new Request('GET', method).end(url);
  }

  // url first
  if (1 == arguments.length) {
    return new Request('GET', method);
  }

  return new Request(method, url);
}

// generate HTTP verb methods

methods.forEach(function(method){
  var name = 'delete' == method ? 'del' : method;
  method = method.toUpperCase();
  request[name] = function(url, fn){
    var req = request(method, url);
    fn && req.end(fn);
    return req;
  };
});

/**
 * Check if `mime` is text and should be buffered.
 *
 * @param {String} mime
 * @return {Boolean}
 * @api public
 */

function isText(mime) {
  var parts = mime.split('/');
  var type = parts[0];
  var subtype = parts[1];

  return 'text' == type
    || 'json' == subtype
    || 'x-www-form-urlencoded' == subtype;
}

/**
 * Check if we should follow the redirect `code`.
 *
 * @param {Number} code
 * @return {Boolean}
 * @api private
 */

function isRedirect(code) {
  return ~[301, 302, 303, 305, 307].indexOf(code);
}
