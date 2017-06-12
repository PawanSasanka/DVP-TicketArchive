/**
 * Created by Sukitha on 5/30/2017.
 */

var mongoose = require("mongoose");
var config =  require("config");
var cli = require("cli");
var jwt = require('jsonwebtoken');
var redis = require('redis');
var logger = require('dvp-common/LogHandler/CommonLogHandler.js').logger;
var Ticket = require('dvp-mongomodels/model/Ticket').Ticket;
var TicketArchive = require('dvp-mongomodels/model/Ticket').TicketArchive;
var moment = require("moment");
var async = require("async");

var options = cli.parse({

    token: [ 's', 'The security token', 'string', "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdWtpdGhhIiwianRpIjoiYWEzOGRmZWYtNDFhOC00MWUyLTgwMzktOTJjZTY0YjM4ZDFmIiwic3ViIjoiNTZhOWU3NTlmYjA3MTkwN2EwMDAwMDAxMjVkOWU4MGI1YzdjNGY5ODQ2NmY5MjExNzk2ZWJmNDMiLCJleHAiOjE5MDIzODExMTgsInRlbmFudCI6LTEsImNvbXBhbnkiOi0xLCJzY29wZSI6W3sicmVzb3VyY2UiOiJhbGwiLCJhY3Rpb25zIjoiYWxsIn1dLCJpYXQiOjE0NzAzODExMTh9.Gmlu00Uj66Fzts-w6qEwNUz46XYGzE8wHUhAJOFtiRo" ],
    duration: [ 'd', 'time', 'int', 30],
    company: [ 'c', 'company id', 'int', 103],
    tenant: [ 't', 'tenant id', 'int', 1],
    status: [ 'a', 'status', 'string', "closed"]

});



var util = require('util');
var mongoip=config.Mongo.ip;
var mongoport=config.Mongo.port;
var mongodb=config.Mongo.dbname;
var mongouser=config.Mongo.user;
var mongopass = config.Mongo.password;
var mongoreplicaset= config.Mongo.replicaset;

var mongoose = require('mongoose');
var connectionstring = '';
if(util.isArray(mongoip)){

    mongoip.forEach(function(item){
        connectionstring += util.format('%s:%d,',item,mongoport)
    });

    connectionstring = connectionstring.substring(0, connectionstring.length - 1);
    connectionstring = util.format('mongodb://%s:%s@%s/%s',mongouser,mongopass,connectionstring,mongodb);

    if(mongoreplicaset){
        connectionstring = util.format('%s?replicaSet=%s',connectionstring,mongoreplicaset) ;
    }
}else{

    connectionstring = util.format('mongodb://%s:%s@%s:%d/%s',mongouser,mongopass,mongoip,mongoport,mongodb)
}



mongoose.connection.on('error', function (err) {
    console.error( new Error(err));
    mongoose.disconnect();

});

mongoose.connection.on('opening', function() {
    console.log("reconnecting... %d", mongoose.connection.readyState);
});


mongoose.connection.on('disconnected', function() {
    console.error( new Error('Could not connect to database'));
    mongoose.connect(connectionstring,{server:{auto_reconnect:true}});
});


mongoose.connection.on('reconnected', function () {
    console.log('MongoDB reconnected!');
});



var redisip = config.Security.ip;
var redisport = config.Security.port;
var redisuser = config.Security.user;
var redispass = config.Security.password;


//[redis:]//[user][:password@][host][:port][/db-number][?db=db-number[&password=bar[&option=value]]]
//redis://user:secret@localhost:6379


var redisClient = redis.createClient(redisport, redisip);

redisClient.on('error', function (err) {
    console.log('Error ' + err);
});

redisClient.auth(redispass, function (error) {

    if(error != null) {
        console.log("Error Redis : " + error);
    }
});

process.on('SIGINT', function() {
    mongoose.connection.close(function () {
        console.log('Mongoose default connection disconnected through app termination');
        process.exit(0);
    });
});


mongoose.connect(connectionstring,{server:{auto_reconnect:true}});

mongoose.connection.once('open', function () {

    console.log('open');
    var payload = jwt.decode(options.token);


    if(payload && payload.iss && payload.jti) {
        var issuer = payload.iss;
        var jti = payload.jti;


        redisClient.get("token:iss:" + issuer + ":" + jti, function (err, key) {

            if (err) {
                return;
            }
            if (!key) {
                return;
            }

            jwt.verify(options.token, key, function(err, decoded) {

                if(decoded) {

                    var now = moment();
                    var older = now.subtract(options.duration, 'days');
                    var company = options.company;
                    var tenant = options.tenant;

                    var query = {
                        company: company,
                        tenant: tenant,
                        status: options.status,
                        "updated_at": {"$lt": older}
                    };

                    Ticket.count(query,function (err, count){

                        if(err){

                            console.error(err)

                        }else{

                            if(count > 0){

                                var length = Math.ceil(count/100);
                                var arr = new Array(length).fill(0);
                                var page = 0;



                                async.eachSeries(arr, function(it, cb){

                                    //page++;

                                    Ticket.find(query).skip(page*100).limit(100).exec(function (err, tickets) {

                                        if (err) {

                                            logger.error(err);

                                        } else {

                                            if (tickets && Array.isArray(tickets) && tickets.length > 0) {

                                                async.eachLimit(tickets, 20,

                                                    function (item, callback) {

                                                        var archivedTicket = TicketArchive({

                                                            tid: item.tid,
                                                            reference: item.reference,
                                                            ticket: item,
                                                            company: item.company,
                                                            tenant: item.tenant
                                                        });

                                                        //console.log(archivedTicket);


                                                        archivedTicket.save(function(ex, obj){

                                                            if(ex){
                                                                logger.error(ex.message);
                                                                callback();
                                                            }else{
                                                                logger.info("Save object succeed ..... ", item.reference);

                                                                item.remove(function(er){
                                                                    if(er){
                                                                        console.error("Remove item failed ", er);
                                                                    }else{
                                                                        console.info("Remove item successful "+item.reference);
                                                                    }

                                                                    callback();

                                                                });


                                                            }

                                                        });

                                                    },
                                                    function (err){
                                                        console.log("Process is completed");
                                                        cb();
                                                    });



                                            }else{

                                                logger.info("Ticket list is empty");
                                            }
                                        }
                                    });



                                },function(error){

                                    console.log("Iteration ia completed");

                                });
                                console.info("Total ticket count is " + count)

                            }else{

                                console.info("Total ticket count is 0");
                            }
                        }
                    });



                }else{
                    console.log("Verification failed");
                }

            });
        });
    }else{
        return;
    }
});


