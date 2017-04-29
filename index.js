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

function sendPushover(uevent) {
    if (!wh.test(new Date())) { return };
    assert.object(uevent);
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
        if (err) console.log(err);
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
