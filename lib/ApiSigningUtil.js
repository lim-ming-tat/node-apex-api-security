const nonceLib = require('nonce')();
const _ = require('lodash');
const qs = require('querystring');
const crypto = require('crypto');
const fs = require('fs');
const { URL } = require('url');
const request = require('superagent');
const winston = require('./Logger');
const Promise = require('bluebird');

let ApiSigningUtil = {};


/**
 * Set winston logging mechanism
 *
 * @param string loglevel Logging level (trace,error,none)
 * @public
 */
ApiSigningUtil.setLogLevel = (loglevel) => {
    winston.level = loglevel;
}


/**
 * Create HMACRSA256 Signature (L1) with a given message
 *
 * @param string message Message to be signed
 * @param string secret App's secret
 *
 * @returns string signature HMACRSA256 Signature
 * @public
 */
ApiSigningUtil.getHMACSignature = (message, secret) => {
    winston.logEnter(message, secret);

    if (isNullOrEmpty(message) || isNullOrEmpty(secret))
    {
        let compiled = _.template('<%= message %> and <%= secret %> must not be null or empty!');
        let errorMessage = compiled({ 'message': 'message', 'secret' : 'secret' });

        winston.error(errorMessage);
        throw new Error(errorMessage);
    }

    let signature = crypto.createHmac('SHA256', secret).update(message).digest('base64');

    winston.logExit(signature);
    return signature;
}


/**
 * Verify HMAC256 Signature (L1)
 *
 * @param string signature Signature to be verified
 * @param string secret App's secret
 * @param string message Message to be signed
 *
 * @returns boolean Verification status
 * @public
 */
ApiSigningUtil.verifyHMACSignature = (signature, secret, message) => {
    winston.logEnter(signature, secret, message);
    winston.logExit(_.isEqual(signature, ApiSigningUtil.getHMACSignature(message, secret)));
    return _.isEqual(signature, ApiSigningUtil.getHMACSignature(message, secret));
}


/**
 * Create RSA256 Signature (Lw) with a given message
 *
 * @param string message Message to be signed
 * @param string secret App's secret
 * @param string passphrase Passphrase
 *
 * @returns number signature RSA256 Signature
 * @public
 */
ApiSigningUtil.getRSASignature = (message, privateKey, passphrase) => {
    winston.logEnter(message, "privateKey***", "passphrase***");

    if (isNullOrEmpty(message) || (privateKey == null))
    {
        let compiled = _.template('<%= message %> and <%= privateKey %> must not be null or empty!');
        let errorMessage = compiled({ 'message': 'message', 'privateKey' : 'privateKey' });

        winston.error(errorMessage);
        throw new Error(errorMessage);
    }

    let signature = crypto.createSign('RSA-SHA256')
    .update(message)
    .sign({
        key: privateKey,
        passphrase: passphrase
    }, 'base64');

    winston.logExit(signature);
    return signature;
}


/**
 * Verify RSA256 Signature (L2)
 *
 * @param string signature Signature to be verified
 * @param string publicKey Public Key
 * @param string message Message to be signed
 *
 * @returns boolean Verification status
 * @public
 */
ApiSigningUtil.verifyRSASignature = (signature, publicKey, message) => {
    winston.logEnter(signature, "publicKey***", message);

    if (isNullOrEmpty(message) || (publicKey == null))
    {
        let compiled = _.template('<%= message %> and <%= publicKey %> must not be null or empty!');
        let errorMessage = compiled({ 'message': 'message', 'publicKey' : 'publicKey' });

        winston.error(errorMessage);
        throw new Error(errorMessage);
    }

    let verifier = crypto.createVerify('sha256');
    verifier.update(message);
    let verifyResult = verifier.verify(publicKey, signature, 'base64');

    winston.logExit(verifyResult);
    return verifyResult;
}

ApiSigningUtil.getPrivateKeyFromPem = (pemFileName) => {
    winston.logEnterExit(pemFileName);

    return fs.readFileSync(pemFileName).toString('ascii');
}

ApiSigningUtil.getPublicKeyFromCer = (cerFileName) => {
    winston.logEnterExit(cerFileName);

    return fs.readFileSync(cerFileName).toString('ascii');
}


/**
 * Generate HTTP Authorize Signature Header for API Gateway
 *
 * @param object reqProps HTTP Signature request properties
 *
 * @returns string signatureToken HTTP Signature token to be append in Authorization header in HTTP
 * @public
 */
ApiSigningUtil.getSignatureToken = (reqProps) => {
    winston.logEnter(reqProps);

    // No Credentials L0
    if (reqProps.appId == null) return null;

    let authPrefix = reqProps.authPrefix.toLowerCase();
    let signature = '';
    let signatureMethod =  _.isNil(reqProps.secret) ? "SHA256withRSA" : "HMACSHA256";

    let baseProps = {
        "authPrefix": authPrefix.toLowerCase(),
        "signatureMethod" : signatureMethod,
        "appId" : reqProps.appId,
        "urlPath" : reqProps.urlPath,
        "httpMethod" : reqProps.httpMethod,
        "formData" : isNullOrEmpty(reqProps.formData) ? null: reqProps.formData,
        "nonce" : isNullOrEmpty(reqProps.nonce) ? nonceLib() : reqProps.nonce,
        "timestamp" : isNullOrEmpty(reqProps.timestamp) ? (new Date).getTime() : reqProps.timestamp

    }

    let baseString = ApiSigningUtil.getSignatureBaseString(baseProps);

    if (!_.isNil(reqProps.secret))
    {
        signature = ApiSigningUtil.getHMACSignature(baseString, reqProps.secret);
    }
    else
    {
        let privateKey = (reqProps.certFileName ? ApiSigningUtil.getPrivateKeyFromPem(reqProps.certFileName) : reqProps.certString);
        signature = ApiSigningUtil.getRSASignature(baseString, privateKey, reqProps.passphrase);
    }

    let signatureToken =
        authPrefix.charAt(0).toUpperCase() + authPrefix.slice(1) + " realm=\"" + reqProps.realm + "\", " +
        authPrefix + "_timestamp=\"" + baseProps.timestamp + "\", " +
        authPrefix + "_nonce=\"" + baseProps.nonce + "\", " +
        authPrefix + "_app_id=\"" + baseProps.appId + "\", " +
        authPrefix + "_signature_method=\"" + baseProps.signatureMethod + "\", " +
        authPrefix + "_signature=\"" + signature + "\", " +
        authPrefix + "_version=\"1.0\"";

    winston.logExit(signatureToken);
    return signatureToken;

};


/**
 * Formulate Signature base string
 *
 * @param object baseProps Base string formulation request properties in JSON object
 *
 * @returns string sigBaseString Signature base string for signing
 * @public
 */
ApiSigningUtil.getSignatureBaseString = (baseProps) => {
    winston.logEnter(baseProps);

    const siteUrl = new URL(baseProps.urlPath);

    if (siteUrl.protocol != "http:" && siteUrl.protocol != "https:")
    {
        let errorMessage = 'Support http and https protocol only!';

        winston.error(errorMessage);
        throw new Error(errorMessage);
    }

    // remove port from url
    const signatureUrl = siteUrl.protocol + "//" + siteUrl.hostname + siteUrl.pathname;
    //const port = siteUrl.port;
    winston.info('url:: %s', signatureUrl);

    let defaultParams = JSON.parse("{ " +
        "\"" + baseProps.authPrefix.toLowerCase() + "_app_id\" : \"" + baseProps.appId + "\"," +
        "\"" + baseProps.authPrefix.toLowerCase() + "_nonce\": \"" + baseProps.nonce + "\"," +
        "\"" + baseProps.authPrefix.toLowerCase() + "_signature_method\": \"" + baseProps.signatureMethod + "\"," +
        "\"" + baseProps.authPrefix.toLowerCase() + "_timestamp\": " + baseProps.timestamp + "," +
        "\"" + baseProps.authPrefix.toLowerCase() + "_version\": \"" + "1.0" + "\"" +
        "}");

    // found querystring in url, transfer to params property
    if (siteUrl.search != null && siteUrl.search.length > 0) {
        winston.info('QueryString:: %s', siteUrl.search);
        let params = qs.parse(siteUrl.search.slice(1));

        defaultParams = _.merge(defaultParams, params);
    }

    if (!_.isNil(baseProps.formData)) {
        defaultParams = _.merge(defaultParams,_.clone(baseProps.formData));
    }

    defaultParams = sortJson(defaultParams);

    let sigBaseString = baseProps.httpMethod.toUpperCase() + "&" + signatureUrl + "&" + qs.stringify(defaultParams, null, null, {encodeURIComponent: decodeURIComponent});

    winston.logExit(sigBaseString);
    return sigBaseString;
};

/**
 * Generate HTTP Authorize HMAC256 Signature Header for API Gateway
 * Legacy interface to be deprecated, please change to getSignatureToken instead
 *
 * @param string realm Application Realm
 * @param string authPrefix Authorization scheme prefix defined in API Gateway
 * @param string httpMethod HTTP Method
 * @param string urlPath API URL
 * @param string appId App ID generated in API Gateway
 * @param string secret App Secret generated in API Gateway
 * @param object formData x-url-encode form data fields in JSON object
 * @param string nonce Random nonce for base string formulation
 * @param string timestamp Timestamp
 *
 * @returns string token HTTP Signature token to be append in Authorization header in HTTP
 * @public
 */
ApiSigningUtil.getTokenFromSecret = (realm, authPrefix, httpMethod, urlPath, appId, secret, formData, nonce, timestamp) => {

    let reqProps = {
        "realm" : realm,
        "appId" : appId,
        "secret" : secret,
        "authPrefix": authPrefix,
        "appId" : appId,
        "urlPath" : urlPath,
        "httpMethod" : httpMethod,
        "formData" : formData,
        "nonce" : nonce,
        "timestamp" : timestamp
    }

    return ApiSigningUtil.getSignatureToken(reqProps);
}


/**
 * Generate HTTP Authorize RSA256 Signature Header for API Gateway with a given Private Key Cert file path
 * Legacy interface to be deprecated, please change to getSignatureToken instead
 *
 * @param string realm Application Realm
 * @param string authPrefix Authorization scheme prefix defined in API Gateway
 * @param string httpMethod HTTP Method
 * @param string urlPath API URL
 * @param string appId App ID generated in API Gateway
 * @param string secret App Secret generated in APi Gateway
 * @param object formData x-url-encode form data fields in JSON object
 * @param string passphrase Signing certificate file or contents's passphrase
 * @param string certFileName Certificate file path
 * @param string nonce Random nonce for base string formulation
 * @param string timestamp Timestamp
 *
 * @returns string token HTTP Signature token to be append in Authorization header in HTTP
 * @public
 */
ApiSigningUtil.getTokenFromCertFileName = (realm, authPrefix, httpMethod, urlPath, appId, formData, passphrase, certFileName, nonce, timestamp) => {

    let reqProps = {
        "realm" : realm,
        "appId" : appId,
        "certFileName" : certFileName,
        "passphrase" : passphrase,
        "authPrefix": authPrefix,
        "appId" : appId,
        "urlPath" : urlPath,
        "httpMethod" : httpMethod,
        "formData" : formData,
        "nonce" : nonce,
        "timestamp" : timestamp
    }

    return ApiSigningUtil.getSignatureToken(reqProps);
}


/**
 * Generate HTTP Authorize RSA256 Signature Header for API Gateway with a given Private Key content
 * Legacy interface to be deprecated, please change to getSignatureToken instead
 *
 * @param string realm Application Realm
 * @param string authPrefix Authorization scheme prefix defined in API Gateway
 * @param string httpMethod HTTP Method
 * @param string urlPath API URL
 * @param string appId App ID generated in API Gateway
 * @param string secret App Secret generated in APi Gateway
 * @param object formData x-url-encode form data fields in JSON object
 * @param string passphrase Signing certificate file or contents's passphrase
 * @param string certString Certificate contents
 * @param string nonce Random nonce for base string formulation
 * @param string timestamp Timestamp
 *
 * @returns string token HTTP Signature token to be append in Authorization header in HTTP
 * @public
 */
ApiSigningUtil.getTokenFromCertString = (realm, authPrefix, httpMethod, urlPath, appId, formData, passphrase, certString, nonce, timestamp) => {

    let reqProps = {
        "realm" : realm,
        "appId" : appId,
        "certString" : certString,
        "passphrase" : passphrase,
        "authPrefix": authPrefix,
        "appId" : appId,
        "urlPath" : urlPath,
        "httpMethod" : httpMethod,
        "formData" : formData,
        "nonce" : nonce,
        "timestamp" : timestamp
    }

    return ApiSigningUtil.getSignatureToken(reqProps);
}

/**
 * Send Test Request to API Gateway.
 *
 * @param string urlPath API URL
 * @param string sigToken HTTP Authorization Header content (Signature Token)
 * @param object caOption CA Certificate(s) path or contents to trust
 * @param object formData x-url-encode form data fields in JSON object
 * @param string httpMethod HTTP Method
 * @param number port  API URL Port number
 *
 * @returns object API Response
 * @public
 */
ApiSigningUtil.sendRequest = (urlPath, sigToken,caOption,formData, httpMethod, port) => {

    return new Promise(function(resolve, reject){

        let ca = function (caOption) {
            if(!isNullOrEmpty(caOption.content)) {
                return caOption.content
            } else {
                return fs.readFileSync(caOption.filePath);
            }
        }

        const targetURL = new URL(urlPath);

        // restore the port no remove during validation
        if (isNullOrEmpty(port)) port = 443;
        targetURL.port = port;

        let req = request(httpMethod, targetURL.href);

        if (sigToken != undefined && sigToken.length > 0) {
            req = req.set("Authorization", sigToken).ca(ca);
        }

        if (httpMethod == "POST" ||httpMethod == "PUT" && formData != undefined) {
            let postData = qs.stringify(formData, null, null, {encodeURIComponent: decodeURIComponent});
            req = req.type("application/x-www-form-urlencoded").set("Content-Length", Buffer.byteLength(postData)).send(postData);
        }

        req.end(function (err, res) {
            if (!err) {
                resolve(res);
            } else {
                reject(err);
            }
        });
    });
}

function isNullOrEmpty(data)
{
    return !data;
}

/**
 * Sorts a JSON object based on the key value in alphabetical order
 *
 * @param object json JSON Object to be sorted
 *
 * @returns object Sorted JSON object
 * @private
 */
function sortJson(json) {
    if (_.isNil(json)) {
        return json;
    }

    let newJSON = {};
    let keys = Object.keys(json);
    keys.sort();

    for (key in keys) {
        newJSON[keys[key]] = json[keys[key]];
    }
    return newJSON;
};

module.exports = ApiSigningUtil;