
/**
 * Module dependencies.
 */

var CookieJar = require('cookiejar').CookieJar;
var CookieAccess = require('cookiejar').CookieAccessInfo;
var parse = require('url').parse;
var request = require('./index');
var methods = require('methods');

/**
 * Expose `Agent`.
 */

module.exports = Agent;

/**
 * Initialize a new `Agent`.
 *
 * @api public
 */

function Agent(options) {
  if (!(this instanceof Agent)) return new Agent(options);
  if (options) this._ca = options.ca;
  this.jar = new CookieJar;
  this.headers = {};
}

/**
 * Sets the specified request to be applied on all requests made by this agent.
 * @param name header name
 * @param name header value
 */
Agent.prototype.set = function(name, value) {
    this.headers[name] = value;
}

/**
 * Attach headers to the request
 * @param {Request} req
 * @api private
 */
Agent.prototype.attachHeaders = function(req) {
    var key;
    for (key in this.headers) {
        if (this.headers.hasOwnProperty(key)) {
            req.set(headers[key]);
        }
    }
}

/**
 * Save the cookies in the given `res` to
 * the agent's cookie jar for persistence.
 *
 * @param {Response} res
 * @api private
 */

Agent.prototype.saveCookies = function(res){
  var cookies = res.headers['set-cookie'];
  if (cookies) this.jar.setCookies(cookies);
};

/**
 * Attach cookies when available to the given `req`.
 *
 * @param {Request} req
 * @api private
 */

Agent.prototype.attachCookies = function(req){
  var url = parse(req.url);
  var access = CookieAccess(url.host, url.pathname, 'https:' == url.protocol);
  var cookies = this.jar.getCookies(access).toValueString();
  req.cookies = cookies;
};

// generate HTTP verb methods

methods.forEach(function(method){
  var name = 'delete' == method ? 'del' : method;

  method = method.toUpperCase();
  Agent.prototype[name] = function(url, fn){
    var self = this;
    var req = request(method, url);
    req.ca(this._ca);

    req.on('response', this.saveCookies.bind(this));
    req.on('redirect', this.saveCookies.bind(this));
    req.on('redirect', function () {
        self.attachCookies(req);
        self.attachHeaders(req);
    });
    
    this.attachCookies(req);
    this.attachHeaders(req);

    fn && req.end(fn);
    return req;
  };
});
