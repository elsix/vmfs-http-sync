var chokidar = require('chokidar');
var http = require('http');
var fs = require('fs')
var winston = require('winston');

winston.level = 'error';

var utils = require('./utils');

server_address=process.argv[process.argv.length - 3];
server_port=process.argv[process.argv.length -2];
path=process.argv[process.argv.length - 1];

max_retries=1;

// We don't really need filesystem events.
// We just need to state be able to produce the same state as on monitored direcotry.
// Unlink doesn't really care if it is directory or file.
// Changed doesnt really care if the file is changed or just craeted.
var generateChange = function(file, retry) {
  var localFile = path + '/' + file;
  var sharedFile = file;
  fs.stat(localFile, function(err, stats) {
    // Just send event directly to the remote machine for missing files
    if (err && err.code === 'ENOENT') {
      sendChange('unlink', sharedFile, retry, null);
      return;
    }
    if (err) {
      winston.error('unexpected error occured ' + JSON.stringify(err));
      return;
    }

    winston.debug('stats for ' + file + ' are ' + JSON.stringify(stats));
    if(stats.isFile()) {
      utils.calcHash(localFile, function(error, sha1) {
        sendChange('copy', sharedFile, retry, sha1);
      });
    } else {
      sendChange('addDir', sharedFile, retry, null);
    }
  })
}

var sendChange = function(event, file, retry, checkSum) {
  winston.debug('sending ' + event + ' for ' + file + ' retried ' + retry);
  if (retry > max_retries) {
    winston.error('unabled to syncronize ' + file + ' retried ' + retry + ' times.');
    return;
  }
  var options = {
    host: server_address,
    port: server_port,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  var req = http.request(options, function(res) {
    var data="";
    res.on('data', function (chunk) {
      data+=chunk;
    });

    res.on('end', function () {
      if (JSON.parse(data)["code"] === utils.ERROR_CODE) {
        winston.warn('error occured while syncing ' + file + ' ' + data);
        generateChange(file, retry + 1);
      } else {
        winston.debug('successful response received ' + data);
      }
    });
  });

  postData = JSON.stringify({
    event: event,
    file: file,
    checkSum: checkSum,
  });

  req.write(postData);

  req.end();
};

chokidar.watch(
  path,
  { ignored: /[\/\\]\./, ignoreInitial: true}
).on('all', function(event, file) {
  var sharedFile=file.replace(path, '');
  generateChange(sharedFile, 0);
});
