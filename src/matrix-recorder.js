"use strict";

// Debug?
const DEBUG = false;

// HELPER FUNCTIONS

// Ask questions to the user
// Promisified from https://st-on-it.blogspot.ca/2011/05/how-to-read-user-input-with-nodejs.html
var ask = function(question, format) {
  var stdin = process.stdin, stdout = process.stdout;

  return new Promise(function(resolve) {
    stdin.resume();
    stdout.write(question + ": ");

    stdin.once('data', function (data) {
      data = data.toString().trim();

      if (format.test(data)) {
        resolve(data);
      } else {
        stdout.write("It should match: " + format + "\n");
        resolve(ask(question, format));
      }
    });
  });
};


// Runs an sqlite3 database query and returns a promise that provides the number of changes
var dbRunPromise = function(query) {
  return new Promise(function(resolve, reject) {
    db.run(query, function(err) {
      if(err) {
        reject(err);
      } else {
        resolve(this.changes);
      }
    });
  });
};


// Creates a new directory if it does not yet exist
var mkdirIfNotExists = function(directory) {
  try {
    fs.mkdirSync(directory);
  } catch(err) {
    // Do nothing if directory already exists, exit otherwise
    if(err.code !== 'EEXIST')  {
      console.log('Could not create directory %s: %s', directory, err.code);
      process.exit(1);
    }
  }
};


// Queue all fetch calls such that they are run sequentially and not in parallel
// (to avoid hammering the homeserver with too many parallel requests)

var queueFetchPromise = Promise.resolve();

var queueFetch = function(url, options) {
  var newPromise = queueFetchPromise.then(function() { 
    console.log('Retrieving ' + url + '...');
    
    var promiseWithRetries = fetch(url, options).catch(function(err) {
      console.log('ERROR retrieving ' + url + ' on first try: ', err);
      console.log('Trying again...');
      return fetch(url, options);
    });
    
    return promiseWithRetries;
  },
  function(err) {
    console.log('ERROR: The  previous item could not be retrieved: ', err);
    console.log('Retrieving ' + url + '...');
    return fetch(url, options);
  });
  
  queueFetchPromise = newPromise;
  return newPromise;
};


// Decrypt a media file and store it on disk
// Adapted from decryptFile function in https://github.com/matrix-org/matrix-react-sdk/blob/57c56992f1e9443db2400c589cccdee877907fd8/src/utils/DecryptFile.js
var decryptFile = function(client, file) {
  const url = client.mxcUrlToHttp(file.url);

  // Download the encrypted file as an array buffer.
  return queueFetch(url)
    .then(function(response) {
      return response.buffer();
    }).then(function(responseData) {
      // Decrypt the array buffer using the information taken from
      // the event content.
      return encrypt.decryptAttachment(responseData, file);
    });
};

// Function to store file on filesystem (decrypt if necessary) and save its reference in the database
var storeFile = function(client, room_id, event_id, file, storageLocation) {
  // Is file encrypted?
  var storePromise;

  if(file.key) {
    console.log('Decrypting file %s...', file.url);
    storePromise = decryptFile(client, file, storageLocation);
  } else {
    console.log('Storing unencrypted file %s...', file.url);
    var url = client.mxcUrlToHttp(file.url);
    storePromise = queueFetch(url)
      .then(function(response) {
        return response.buffer();
      });
  }

  return storePromise
    .then(function(responseData) {
      // We write the decrypted / obtained file to disk
      return new Promise(function (resolve, reject) {
        var urlToPath = file.url.replace('mxc://', '') + '.' + (mime.extension(file.mimetype) || 'bin');
        var fullPath = path.join(storageLocation, urlToPath);

        // Do we need to create the subdirectory?
        mkdirIfNotExists(path.dirname(fullPath));

        // Let's write the file.
        fs.writeFile(fullPath, responseData, function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(urlToPath);
          }
        });
      });
    })
    .then(
      function(path) {
        db.run('INSERT INTO files_stored (room_id, event_id, mxc_url, mimetype, filename) VALUES (?, ?, ?, ?, ?)',
          room_id, event_id, file.url, file.mimetype, path,
          function(err) {
            if(err) {
              console.log('SQLite error: %s', err);
              console.log('Exiting...');
              process.exit(1);
            }
          });
      },
      function(err) {
        console.log('ERROR decrypting / storing file: %s', err);
      }
    );
};



// Main function to process incoming room timeline events
var processRoomTimeline = function(event, room) {

  // Recalculate room to be safe
  room.recalculate(client.credentials.userId);

  // Obtain content
  var content = event.getContent();

  // Debug output
  if(DEBUG) {
    // Log to console
    console.log(
      // the room name will update with m.room.name events automatically
      "--------- (%s) %s ---------", room.name, event.getSender()
    );

    console.log('Room: %s (%s)', room.name, room.roomId);
    console.log('Event ID: %s', event.getId());
    console.log('Event Date: %s', event.getDate());
    console.log('Event Sender: %s', event.getSender());
    console.log('Event Sender Key: %s', event.getSenderKey());
    console.log('Event Target: %s', (event.target ? event.target.userId : ''));
    console.log('Event Type: %s', event.getType());
    console.log('Encryption? %s', event.isEncrypted());

    console.log('Content:');
    console.log(JSON.stringify(content));

    console.log('Unsigned event data:' + JSON.stringify(event.getUnsigned()));
  }

  // Output without debug data
  console.log('[%s] %s: %s' + (event.isEncrypted() ? ' (encrypted)' : '') + ' received from %s for room "%s" (%s)', event.getDate(), event.getId(), event.getType(), event.getSender(), room.name, room.roomId);

  // Are there any files that need to be retrieve?
  if(content.file && content.file.url && content.file.url.substr(0, 6) === 'mxc://') {
    // Encrypted files are being provided by matrix-js-sdk in the 'file' object (including key data for decrypt)
    storeFile(client, room.roomId, event.getId(), content.file, mediaPath);
  }

  if(content.info && content.info.thumbnail_file && content.info.thumbnail_file.url && content.info.thumbnail_file.url.substr(0, 6) === 'mxc://') {
    // Encrypted thumbnails are being provided by matrix-js-sdk in the 'thumbnail_file' object (including key data for decrypt)
    storeFile(client, room.roomId, event.getId(), content.info.thumbnail_file, mediaPath);
  }

  // DEBUG
  if(content.url && !content.info) {
    console.log('WARNING: Content with URL but without info!');
    console.log(content);
  }
  // DEBUG

  if(content.url && content.info && content.info.mimetype && content.url.substr(0, 6) === 'mxc://') {
    // For messages that are not encrypted, file data is provided via "url" property and "info.mimetype" property
    // We need to construct the relevant parts of the "file" object ourselves
    storeFile(client, room.roomId, event.getId(), { url: content.url, mimetype: content.info.mimetype }, mediaPath);
  }

  if(content.info && content.info.thumbnail_info && content.info.thumbnail_info.mimetype && content.info.thumbnail_url && content.info.thumbnail_url.substr(0, 6) === 'mxc://') {
    // For messages that are not encrypted, thumbnail data is provided via "info.thumbnail_url" property and "info.thumbnail_info.mimetype" property
    // We need to construct the relevant parts of the "file" object ourselves
    storeFile(client, room.roomId, event.getId(), { url: content.info.thumbnail_url, mimetype: content.info.thumbnail_info.mimetype }, mediaPath);
  }


  // Write to SQLite database
  db.run('INSERT INTO events_received (room_id, room_name, event_id, event_date, sender, sender_key, target, event_type, encrypted, content, unsigned_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    room.roomId,
    room.name,
    event.getId(),
    event.getDate(),
    event.getSender(),
    event.getSenderKey(),
    (event.target ? event.target.userId : ''),
    event.getType(),
    event.isEncrypted(),
    JSON.stringify(content),
    JSON.stringify(event.getUnsigned()),
    function(err) {
      if(err) {
        console.log('SQLite error: %s', err);
        console.log('Exiting...');
        process.exit(1);
      }
    }
  );

};





// INITIALIZATION STARTS HERE

// Use path and fs
const path = require('path');
const fs = require('fs');

// Use fetch
const fetch = require('node-fetch');

// Use node-encrypt-attachment, our adaptation of browser-encrypt-attachment
const encrypt = require('./node-decrypt-attachment');

// Use mime
const mime = require('mime-types');

// Loading libolm (if available)
try {
  console.log('Loading olm...');
  global.Olm = require('olm');
} catch (err) {
  console.log('WARNING: We couldn\'t load libolm: ' + err);
  console.log('WARNING: Matrix Recorder will run without end-to-end encryption support!');
}

// Loading Matrix SDK
var sdk = require("matrix-js-sdk");
var client = undefined;



// Has a directory been given on the command line?
// Otherwise show information message.
var targetDir = process.argv[2];

if(targetDir === undefined) {
  console.log('You need to give Matrix Recorder the name of a directory it should use to store your user credentials (incl. E2E keys) and the recorded Matrix messages, e.g. like that:\n\n  node matrix-recorder.js  ./my_matrix_log\n\n');
  process.exit(1);
}

// Path for storing any decrypted files
var mediaPath = path.join(targetDir, 'media');

// Do we need to create the path?
mkdirIfNotExists(targetDir);
mkdirIfNotExists(mediaPath);


// Loading localStorage module
if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require('node-localstorage').LocalStorage;
  var localStorage = new LocalStorage(path.join(targetDir, 'localstorage'));
}

// Load sqlite3 module
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(path.join(targetDir, 'messages.sqlite'));


// Items to retrieve for initial sync (we overwrite for initial setup, otherwise get zero items to avoid missing out on duplicates).
var is_initial_run = false;
var items_to_retrieve = 0;


// Our initialization promise
var initPromise;
var authData = {};


// Do we already have data in the localStorage? Then we can start the Matrix SDK right away.
if(localStorage.getItem('baseUrl') && localStorage.getItem('accessToken')) {
  // Yes, let's go.
  initPromise = Promise.resolve();

} else {
  // No, we need to populate this data from user input.
  is_initial_run = true;
  initPromise =
    ask('Your homeserver (give full URL)', /^https?:\/\/[a-z0-9A-Z\.-]+(:[0-9]+)?(\/.*)?$/).then(
      function(homeserver) {
        localStorage.setItem('baseUrl', homeserver.replace(/\/$/, ""));

        // Ask for username
        return ask('Your username at the homeserver', /^.+$/);
      }
    ).then(
      function(user) {
        authData.user = user;

        // Ask for password
        return ask('Your password at the homeserver', /^.+$/);
      })
      .then(
        function(password) {
          authData.password = password;

          // Ok, let's start login process to obtain accessToken and deviceId.
          // We use a new temporary matrix client for this
          authData.client = sdk.createClient({
            baseUrl: localStorage.getItem('baseUrl')
          });

          console.log('Trying to log in...');
          return authData.client.login('m.login.password', {user: authData.user, password: authData.password, initial_device_display_name: 'Matrix Recorder' });
        }
      )
      .then(
        function(res) {
          // Console log
          console.log('Logged in as ' + res.user_id);
          localStorage.setItem('userId', res.user_id);
          localStorage.setItem('accessToken', res.access_token);
          localStorage.setItem('deviceId', res.device_id);

          // Ok, ask for number of items to retrieve for initial download.
          return ask('No of items to retrieve for initial sync', /^([0-9]*)$/);
        },
        function(err) {
          console.log('Error when trying to log in: ' + JSON.stringify(err));
          process.exit(1);
        }
      )
     .then(
      function(_items_to_retrieve) {
        // Default to 100.
        items_to_retrieve = Number(_items_to_retrieve);
        if(isNaN(items_to_retrieve)) { items_to_retrieve = 100; }
      }
    ).then(
      function() {
        // Okay, we are done with the questions. We need to initialize the SQlite database, though, if it does not yet
        // contain the relevant tables.

        return new Promise(function (resolve, reject) {
          db.all('SELECT name FROM sqlite_master WHERE type="table"', function (err, rows) {
            if(err) {
              reject(err);
            } else {
              var existingTables = rows.map(function(d) { return d['name']; });

              var createTables = [];

              // Create events_received table if it does not yet exist
              if(existingTables.indexOf('events_received') === -1) {
                createTables.push(dbRunPromise("CREATE TABLE events_received (room_id VARCHAR(300), room_name VARCHAR(500), event_id VARCHAR(300), event_date DATETIME, sender VARCHAR(300), sender_key VARCHAR(200), target VARCHAR(300), event_type VARCHAR(200), encrypted BOOLEAN, content BLOB, unsigned_data BLOB)"));
              }

              // Create files_stored table if it does not yet exist
              if(existingTables.indexOf('files_stored') === -1) {
                createTables.push(dbRunPromise("CREATE TABLE files_stored ( room_id VARCHAR(300), event_id VARCHAR(300), mxc_url VARCHAR(300), mimetype VARCHAR(100), filename VARCHAR(300) )"));
              }

              resolve(Promise.all(createTables));
            }
          });
        });

      }
    );
}


initPromise.then(function() {
  // Create in memory store
  var matrixStore = new sdk.MatrixInMemoryStore();

  // Create client
  client = sdk.createClient({
    baseUrl: localStorage.getItem('baseUrl'),
    accessToken: localStorage.getItem('accessToken'),
    userId: localStorage.getItem('userId'),
    sessionStore: new sdk.WebStorageSessionStore(localStorage),
    store: matrixStore,
    deviceId: localStorage.getItem('deviceId')
  });

  console.log('Starting client for initial sync...');
  client.startClient({ initialSyncLimit: items_to_retrieve });

  if(is_initial_run) {
    // For the initial run, we will also capture events from the initial sync (backfill)
    // Afterwards, we will ignore those
    client.on('Room.timeline', processRoomTimeline);
  }

  client.on('sync', function(state, prevState, data) {
    if(state === 'PREPARED') {
      // This state is emitted when the first initial sync completes
      // We immediately stop the client.
      console.log('Stopping client after initial sync...');
      client.stopClient();

    } else if(state === 'STOPPED') {
      // Ok, the client is stopped. We remove this listener and restart the client with
      // proper sync token and large initialSyncLimit
      client.removeAllListeners('sync');

      // We set the syncToken where we want to start.
      // If we do not have a sync token, we will start from the prior initial sync
      // (we will never get old stuff at the moment).
      if(localStorage.getItem('syncToken')) {
        matrixStore.setSyncToken(localStorage.getItem('syncToken'));
      } else {
        localStorage.setItem('syncToken', client.store.getSyncToken());
      }

      console.log('Client stopped, re-starting with right sync token and large initialSyncLimit...');

      // Retrieve all timeline messages and store them in the SQlite database (if listener is not yet set)
      if(!is_initial_run) {
        client.on('Room.timeline', processRoomTimeline);
      }

      client.on('sync', function(state, prevState, data) {
        if(state === 'SYNCING') {
          // Update sync token in storage
          console.log('Updating sync token in storage to %s', client.store.getSyncToken());
          localStorage.setItem('syncToken', client.store.getSyncToken());
        } else if(state === 'PREPARED') {
          // Initial sync has completed
          console.log('INITIAL SYNC HAS COMPLETED.');
          console.log('However, the Matrix library might still decrypt encrypted events. We suggest waiting for a few minutes prior to shutting down Matrix Recorder again.');
          console.log('Our device key for verification: ' + client.getDeviceEd25519Key());
        } else if(state === 'ERROR') {
          console.log('ERROR while trying to sync messages: %s', data.error);
          console.log('Exiting...');
          process.exit(1);
        }
      });

      // Let's start the client.
      client.startClient({ initialSyncLimit: 100000 });


    } else if(state === 'ERROR') {
      console.log('ERROR while trying to sync messages: %s', data.error);
      console.log('Exiting...');
      process.exit(1);
    }
  });









});
