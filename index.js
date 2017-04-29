var assert = require('assert-plus');
var config = require('./etc/config');
var fs = require('fs');
var path = require('path');
var push = require( 'pushover-notifications' );
var r = require('rethinkdb');
var rdbpool = require('rethinkdb-pool');
var WorkHours = require('working-hours').WorkingHours;
var util = require('util');


assert.object(config.rethinkdb, 'Need a rethinkdb configuration');
var database_config  = config.rethinkdb;
if (config.ssl) {
    config.ssl.ca = fs.readFileSync(path.join(__dirname, config.ssl.ca));
    database_config.ssl = config.ssl;
}

assert.object(config.pushover, 'Need pushover configuration');
assert.string(config.pushover.user, 'Pushover user');
assert.string(config.pushover.token, 'Pushover token');
var p = new push( {
    user: config.pushover.user,
    token: config.pushover.token
});

var hours = config.workinghours || '00:00-11:59';

var pool = new rdbpool(database_config);
var wh = new WorkHours(hours);

function shouldSendPushover(cb) {
    assert.func(cb, "Callback function");
    if (!wh.test(new Date())) { return cb(false)};
    var q = r.table('pushover').orderBy({index: r.desc('date')}).limit(1);
    pool.run(q, function(err, cursor) {
        if (err) throw err;
        cursor.toArray(function(err, results) {
            if (err) throw err;
            var last = results[0] || {date: '0'};
            if (((Date.now() / 1000) - (last.date / 1000)) <  300) {
                return cb(false);
            }
            cb(true);
        });
    });
}

function sendPushover(uevent) {
    assert.object(uevent);
    shouldSendPushover( function(shouldSend) {
        if (!shouldSend) { return };
        var msg = {
            message: util.format('Motion detected %s', uevent.camera_desc),
            title: config.pushover.title || 'Motion',
            sound: config.pushover.sound || 'gamelan',
            priority: config.pushover.priority || 0
        };
        if (config.pushover.device) {
            msg.device = config.pushover.device
        }

        p.send(msg, function(err, result) {
            if (err) {
                return console.log(err);
            }
            msg.date = Date.now();
            var q = r.table('pushover').insert(msg);
            pool.run(q, function(err, result) {
                if (err) throw err;
            });
        });
    });
}

function processEvent(row) {
    var uevent = row.new_val;
    assert.object(uevent, 'event should be an object');
    switch (uevent.event) {
        case 'STARTED':
            sendPushover(uevent);
        case 'ADDING':
            break;
        case 'ENDED':
            break;
        case 'CLOSING':
            break;
        default:
            throw new Error('Unknown event type');
    }
}

var eventsQuery = r.table('events').changes();

pool.run(eventsQuery, function(err, cursor) {
    if (err) throw err;
    cursor.each(function(err, row) {
        if (err) throw err;
        processEvent(row);
    });
});
