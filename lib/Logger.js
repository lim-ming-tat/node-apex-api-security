'use strict'
var winston = require('winston');

const logLevel = { none: 0, critical: 1, error: 2, warning: 3, info: 4, debug: 5, trace: 6 }

var logger = new (winston.Logger)({
    transports: [
      new (winston.transports.Console)({'timestamp':true})
    ]
});

logger.setLevels(logLevel);

//logger.level = 'trace';
//logger.level = 'error';
//logger.level = 'none';

logger.logEnter = function(...argv)
{
    logger.trace('%s Enter :: Params :: %s', getFunctionName(), ...argv);    
};

logger.logEnterExit = function(...argv)
{
    logger.trace('%s Enter/Exit :: Params :: %s', getFunctionName(), ...argv);    
};

logger.logExit = function(...argv)
{
    logger.trace('%s Exit :: Return :: %s', getFunctionName(), ...argv);    
};

function getFunctionName()
{
    var functionNames = ((new Error().stack).split("at ")[3]).trim().split(' ')[0].split('.');

    return functionNames[functionNames.length - 1];
}

module.exports = logger;