"use strict";


//// INIT STARTS HERE

// Use path and fs
const path = require('path');
const fs = require('fs');

// Use marked
const marked = require('marked');

// The target directory must be provided as first command line option
// All optional parameters can follow afterwards
var targetDir = process.argv[2];

var date_start;
var date_end;
for(let i = 3; i < process.argv.length; ++i) {
  switch(process.argv[i]) {
    case "--start":
      date_start = new Date(process.argv[i+1]);
      ++i;
      break;
    case "--end":
      date_end = new Date(process.argv[i+1]);
      ++i;
      break;
    default:
      console.log("No reader for option %s", process.argv[i])
  }
}

// Has a directory been given on the command line?
// Otherwise show information message.
if(targetDir === undefined) {
  console.log('You need to give Recorder-to-HTML the name of the Matrix Recorder directory that contains the sqlite database to convert, like that:\n\n  node recorder-to-html.js  ./my_matrix_log\n\n');
  process.exit(1);
}

// Does target directory exist?
try {
  fs.accessSync(targetDir, fs.constants.R_OK | fs.constants.W_OK);
} catch(err) {
  console.log('The directory you have specified does not exist or you do not have read and write access there.');
  console.log(err);
  process.exit(1);
}

// Does target sqlite database exist?
try {
  fs.accessSync(path.join(targetDir, 'messages.sqlite'), fs.constants.R_OK | fs.constants.W_OK);
} catch(err) {
  console.log('The directory you have specified does not exist or you do not have read and write access there.');
  console.log(err);
  process.exit(1);
}

// Does html sub-directory *not* exist?
// Otherwise we fail as we do not want to accidentally overwrite anything.
// Create html directory if it does not yet exist.
try {
  fs.mkdirSync(path.join(targetDir, 'html'));
} catch(err) {
  if(err.code === 'EEXIST') {
    console.log('The html/ directory already exists. We will stop now because we do not want to accidentally overwrite anything. Please remove html/ manually first if you want to re-create it.');
  } else {
    console.log('Could not create html directory: %s', directory, err.code);
  }

  process.exit(1);
}

// Load sqlite3 module
const sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(path.join(targetDir, 'messages.sqlite'));


// Load mustache
const Mustache = require('mustache');


// Global variables
var roomNames = {};
var roomFiles = {};
var rooms = [];
var fileNames = {};

// The WHERE query used for all events to be retrieved
var where_elements = [ "event_type IN ('m.room.member', 'm.room.message')" ];

// Limit start of the events to retrieve
if(date_start) {
  where_elements.push("event_date >= $date_start");
}

// Limit end of the events to retrieve
if(date_end) {
  where_elements.push("event_date <= $date_end");
}

// Combine
var where_string = where_elements.join(" AND ");

// The parameter object to be bound to the WHERE elements
var where_parameters = { $date_start: date_start, $date_end: date_end };


// Copy static files style.css, welcome.html
console.log('Copying style.css...');
copyFile('templates/style.css', path.join(targetDir, 'html', 'style.css'))
  .then(
    function() {
      console.log('Copying welcome.html...');
      return copyFile('templates/welcome.html', path.join(targetDir, 'html', 'welcome.html'));
    }
  )

  // Process files in the database
  .then(
    function() {
      console.log('Retrieving all files specified in the database...');
      return promiseDbAll("SELECT DISTINCT mxc_url, filename FROM files_stored WHERE mxc_url IS NOT NULL AND filename IS NOT NULL ORDER BY mxc_url");
    }
  )
  .then(
    function(rows) {
      // Ok, we have received all files.
      console.log('Received files. Processing.');

      rows.forEach(function(row) {
        fileNames[row['mxc_url']] = '../media/' + row['filename'];
      });

      return rows.length;
    }
  )

// Process rooms from database
  .then(
    function() {
      // Note that we only show rooms with at least one message in them.
      console.log('Retrieving all rooms from database...');
      return promiseDbAll("SELECT DISTINCT room_id, room_name, event_date FROM events_received WHERE " + where_string + " ORDER BY room_id, event_date DESC", where_parameters);
    }
  )
  .then(
    function(rows) {
      // Ok, we have received room data.
      console.log('We have received room data. Processing:');

      var prevRoom = '';
      rows.forEach(function(row) {
        if(prevRoom !== row['room_id']) {
          // We only look at the first line for each room_id, which will be the newest room name
          roomNames[row['room_id']] = row['room_name'];
          roomFiles[row['room_id']] = row['room_id'].replace(/[^a-zA-Z0-9\.-]/g, '_') + '.html';

          rooms.push({
            room_id: row['room_id'],
            room_name: row['room_name'],
            room_file: roomFiles[row['room_id']]
          });

          prevRoom = row['room_id'];
        }
      });

      // Ok, now write the room file using Mustache...
      mustacheRender('templates/index.html', path.join(targetDir, 'html', 'index.html'), { rooms: rooms });

      // Ok, now retrieve all timelines events for all rooms...
      return new Promise(function(resolve, reject) {
        var prevRoom = '';
        var roomTimeline = [];

        db.each("SELECT * FROM events_received WHERE " + where_string + " ORDER BY room_id, event_date", where_parameters,
          // Called on every row
          function(err, row) {
            if(err) {
              reject(err);
            } else {
              // Skip rooms which don't have any messages in them (and for which we thus have no file name)
              if(!roomFiles[row['room_id']]) {
                return;
              }

              // Render previous room
              if(prevRoom !== row['room_id']) {
                if(prevRoom) {
                  renderRoom(prevRoom, roomNames[prevRoom], path.join(targetDir, 'html', roomFiles[prevRoom]), roomTimeline);
                }

                prevRoom = row['room_id'];
                roomTimeline = [];
              }

              // Ok, add data to timeline.
              if(row['event_type'] === 'm.room.member') {
                var eventDetails = {
                  type: row['event_type'],
                  date: new Date(row['event_date']),
                  sender: row['sender'],
                  targetFallbackSender: (row['target'] ? row['target'] : row['sender']),
                  data: JSON.parse(row['unsigned_data'])
                };

                eventDetails['membership_' + JSON.parse(row['content']).membership] = true;
                roomTimeline.push(eventDetails);

              } else if(row['event_type'] === 'm.room.message') {
                var eventDetails = {
                  type: row['event_type'],
                  date: new Date(row['event_date']),
                  sender: row['sender'],
                  targetFallbackSender: (row['target'] ? row['target'] : row['sender']),
                  data: JSON.parse(row['content'])
                };

                if(eventDetails.data.msgtype === 'm.text') {
                  // Regular text
                  eventDetails['message'] = true;

                } else if(eventDetails.data.msgtype === 'm.image') {
                  // Image
                  eventDetails['message_image'] = true;

                } else if(eventDetails.data.msgtype === 'm.video') {
                  // Video
                  eventDetails['message_video'] = true;

                } else if(eventDetails.data.msgtype === 'm.file') {
                  // File
                  eventDetails['message_file'] = true;

                }

                // File?
                if(eventDetails.data.file && eventDetails.data.file.url && fileNames[eventDetails.data.file.url]) {
                  // Encrypted files are being provided by matrix-js-sdk in the 'file' object (including key data for decrypt)
                  eventDetails['file'] = fileNames[eventDetails.data.file.url];
                } else if(eventDetails.data.url && fileNames[eventDetails.data.url]) {
                  // For messages that are not encrypted, file data is provided via "url" property
                  eventDetails['file'] = fileNames[eventDetails.data.url];
                }

                // Thumbnail?
                if(eventDetails.data.info && eventDetails.data.info.thumbnail_file && eventDetails.data.info.thumbnail_file.url && fileNames[eventDetails.data.info.thumbnail_file.url]) {
                  // Encrypted thumbnails are being provided by matrix-js-sdk in the 'thumbnail_file' object
                  eventDetails['thumbnail_file'] = fileNames[eventDetails.data.info.thumbnail_file.url];
                } else if(eventDetails.data.info && eventDetails.data.info.thumbnail_info && eventDetails.data.info.thumbnail_url && fileNames[eventDetails.data.info.thumbnail_url]) {
                  // For messages that are not encrypted, thumbnail data is provided via "info.thumbnail_url" property
                  eventDetails['thumbnail_file'] = fileNames[eventDetails.data.info.thumbnail_url];
                }

                roomTimeline.push(eventDetails);

              }

              // Done.
            }

            // Done processing row.
          },
          // Called on completion
          function(err, numRows) {
            if(err) {
              reject(err);
            } else {
              // Render last room
              renderRoom(prevRoom, roomNames[prevRoom], path.join(targetDir, 'html', roomFiles[prevRoom]), roomTimeline);
              resolve(numRows);
            }
          }
        );
      });
    }
  )
  .then(
    function() {
      // Done. Show filename.
      console.log('Done.');
      console.log('The formatted timeline is available at: %s', path.join(targetDir, 'html', 'index.html'));
    },
    function(err) {
      // An error occured somehwere
      console.log('An ERROR occured: %s', err);
      process.exit(1);
    }
  );








//// HELPER FUNCTIONS


// File copy
// Adapted from: https://stackoverflow.com/questions/11293857/fastest-way-to-copy-file-in-node-js

function copyFile(source, target) {
  return new Promise(function(resolve, reject) {
    var rd = fs.createReadStream(source);

    rd.on("error", function(err) {
      reject(err);
    });
    var wr = fs.createWriteStream(target);
    wr.on("error", function(err) {
      reject(err);
    });
    wr.on("close", function(ex) {
      resolve();
    });

    rd.pipe(wr);
  });
}


// Promised version of db.all
function promiseDbAll(query, query_parameters) {
  return new Promise(function(resolve, reject) {
    var callbackFunction = function (err, rows) {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    };
    
    if(query_parameters) {
      db.all(query, query_parameters, callbackFunction);
    } else {
      db.all(query, callbackFunction);
    }
  });
}


// Promised function for Mustache that opens template, applies mustache and writes to output file
function mustacheRender(input, output, data) {
  return new Promise(function(resolve, reject) {
    fs.readFile(input, 'utf-8', function(err, inputHtml) {
      if(err) {
        reject(err);
      } else {
        var outputHtml = Mustache.render(inputHtml, data);
        fs.writeFile(output, outputHtml, function(err) {
          if(err) {
            reject(err);
          } else {
            resolve(output);
          }
        });
      }
    });
  });
}


function renderRoom(room_id, room_name, room_file, timeline) {
  if(room_id !== '' && room_file) {
    return mustacheRender('templates/timeline.html', path.join(targetDir, 'html', roomFiles[room_id]),
        {
          room_id: room_id,
          room_name: room_name,
          room_file: room_file,
          timeline: timeline,

          dateFormat: function() {
            return this.date.toISOString().replace('T', ' ').replace(/\.[0-9]+Z$/, '');
          },

          bodyFormat: function() {
            return marked(this.data.body, { sanitize: true });
          }
        }
      );
  }
}
