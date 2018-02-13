#!/usr/bin/env nodejs

// Set the following environment variables:
//   CONTAINER_ID (optional)

// If you want this to be a processing server (must have mountainlab installed)
//   DATA_DIRECTORY (use * for default)

// If you want to listen
//   LISTEN_PORT (e.g., 6057, or * for default)

// To connect to a parent lari server
//   PARENT_LARI_URL (optional)

// To turn on process caching:
//   LARI_PROCESS_CACHE=ON

// Not used yet
//   DOCSTOR_URL (optional)
//   CONFIG_DOC (optional)

/*
There are two types of lari servers.
Type 1. Processing server (or container within a processing server)
Type 2. A hub for accessing multiple (child) lari server

For type 1, you can either listen on a port (LISTEN_PORT env var) or
you can connect to a parent (hub) server via PARENT_LARI_URL

For type 2, you must listen on a port LISTEN_PORT

Child servers that connect in to a hub parent should have a container id (CONTAINER_ID env var)

For type 1 servers, ie that actually do processing, you must set the
DATA_DIRECTORY environment variable. This is where all the actual
intermediate and result files will be stored.

For type 1 servers, you must also install mountainlab, and you should
also install mountainlab-mpdock, and install the kbucket_upload ML package

*/

// All the environment variables in .env will be loaded
require('dotenv').config(__dirname+'/.env');


// Some utility functions
var lari_http_post_json=require(__dirname+'/lariclient.js').lari_http_post_json;

// Not used at the moment
// var GoogleAuth = require('google-auth-library');
// var jwt = require('jsonwebtoken');
DocStorClient = require(__dirname+'/docstorclient.js').DocStorClient;

// Not used for now
//var DOCSTOR_URL=process.env.DOCSTOR_URL||'';
//var CONFIG_DOC=process.env.CONFIG_DOC||'';
/*
if (CONFIG_DOC) {
	if (!DOCSTOR_URL) {
		console.error('Missing environment variable: DOCSTOR_URL');
		return;
	}
}
*/

var handle_api_2=require(__dirname+'/lariapi.js').handle_api_2;

var express = require('express');

// * means to set the default listen port (important for heroku, which assigns the port via the PORT env var)
if (process.env.LISTEN_PORT=='*') {
	process.env.LISTEN_PORT=process.env.PORT||6057;
}

if (process.env.LISTEN_PORT) {
	// In this case we need to listen for http or https requests
	var app = express();

	app.set('port', (process.env.LISTEN_PORT));

	// not used for now
	/*
	var lari_config=null;
	var last_update_lari_config=0;
	setTimeout(function() {
		do_update_lari_config();
	},100);
	*/


	app.use(function(req,resp,next) {
		// A request has been received either from the client or from a child lari server
		var url_parts = require('url').parse(req.url,true);
		var host=url_parts.host;
		var path=url_parts.pathname;
		var query=url_parts.query;
		if (path=='/api/spec') {
			// Request the spec for a processor
			handle_api('spec',req,resp);
		}
		else if (path=='/api/queue-process') {
			// Start (or queue) a process
			handle_api('queue-process',req,resp);
		}
		else if (path=='/api/probe-process') {
			// Check on the state of a queued, running, or finished process
			handle_api('probe-process',req,resp);
		}
		else if (path=='/api/cancel-process') {
			// Cancel a queued or running process
			handle_api('cancel-process',req,resp);
		}
		else if (path=='/api/find-file') {
			// Check to see if a file is on the processing server (via prv-locate)
			handle_api('find-file',req,resp);
		}
		else if (path=='/api/get-file-content') {
			// Return the content of a relatively small text file on the server (found via prv-locate)
			// (To access the content of larger output files, use kbucket.upload)
			handle_api('get-file-content',req,resp);
		}
		else if (path=='/api/poll-from-container') {
			// A child lari server (container) is sending a poll request
			// This server will reply with requests from the client that need to be handled by the child
			handle_api('poll-from-container',req,resp);
		}
		else if (path=='/api/responses-from-container') {
			// A child lari server (container) is sending some responses
			// These are responses to requests (initiated by the client) and returned in the poll-from-container above
			handle_api('responses-from-container',req,resp);
		}
		else {
			next();
		}
	});

	// Start listening
	app.listen(app.get('port'), function() {
	  console.log ('lari is running on port', app.get('port'));
	});

	function handle_api(cmd,REQ,RESP) {
		// handle an api command from the client or child lari server
		var url_parts = require('url').parse(REQ.url,true);
		var host=url_parts.host;
		var path=url_parts.pathname;
		var query=url_parts.query;

		if (REQ.method == 'OPTIONS') {
			var headers = {};
			
			//allow cross-domain requests
			/// TODO refine this
			
			headers["Access-Control-Allow-Origin"] = "*";
			headers["Access-Control-Allow-Methods"] = "POST, GET, PUT, DELETE, OPTIONS";
			headers["Access-Control-Allow-Credentials"] = false;
			headers["Access-Control-Max-Age"] = '86400'; // 24 hours
			headers["Access-Control-Allow-Headers"] = "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization";
			RESP.writeHead(200, headers);
			RESP.end();
		}
		else {
			// We'll handle both GET and POST requests, and call handle_api_2 once the query has been parsed
			if (REQ.method=='GET') {
				handle_api_2(cmd,query,create_closer(REQ),function(resp) {
					send_json_response(RESP,resp);
				});
			}
			else if (REQ.method=='POST') {
				receive_json_post(REQ,function(post_query) {
					if (!post_query) {
						var err='Problem parsing json from post';
						console.log (err);
						send_json_response({success:false,error:err});
						return;
					}
					handle_api_2(cmd,post_query,create_closer(REQ),function(resp) {
						send_json_response(RESP,resp);
					});
				});
			}
			else {
				send_json_response({success:false,error:'Unsupported request method: '+REQ.method});
			}
		}
	}
}

if (process.env.PARENT_LARI_URL) {
	// In this case we are connecting to a parent (hub) lari server. We will send poll requests.

	// CONTAINER_ID is required
	if (!process.env.CONTAINER_ID) {
		console.warn('Environment variable not set: CONTAINER_ID.');
		return;
	}

	console.log ('Connecting to parent: '+process.env.PARENT_LARI_URL);
	var container_client=new ContainerClient();
	container_client.setLariUrl(process.env.PARENT_LARI_URL);
	container_client.setContainerId(process.env.CONTAINER_ID);
	container_client.setRequestHandler(function(cmd,query,callback) {
		// Here we respond to api request from client that has been routed through the parent lari server
		console.log ('Handling api request in container: '+cmd);
		handle_api_2(cmd,query,create_closer(null),function(resp) {
			callback(resp);
		});
	});
	container_client.start();
}

function ContainerClient() {
	this.setContainerId=function(id) {m_container_id=id;};
	this.setLariUrl=function(url) {m_url=url;};
	this.start=function() {start();};
	this.setRequestHandler=function(handler) {m_request_handler=handler;};

	var m_container_id='';
	var m_url='';
	var m_running=false;
	var m_active_polls={};
	var m_request_handler=function(cmd,query,callback) {
		callback({success:false,error:'no request handler has been set.'});
	};

	function start() {
		m_running=true;
	}

	function add_poll() {
		if (!m_container_id) {
			console.error('Container id not set in ContainerClient.');
			return;
		}
		var poll={
			timestamp:new Date()
		};
		var poll_id=lari_make_random_id(10);
		m_active_polls[poll_id]=poll;

		var url=m_url+'/api/poll-from-container';
		console.log ('Making poll request to: '+url);
		lari_http_post_json(url,{container_id:m_container_id},{},function(err,resp) {
			if (err) {
				console.error('Error making poll request to lari server: '+err);
				delete m_active_polls[poll_id];
				return;
			}
			if (!resp.success) {
				console.error('Error in poll request to lari server: '+resp.error);
				delete m_active_polls[poll_id];
				return;
			}
			if ('requests' in resp) {
				for (var i in resp.requests) {
					handle_request_from_server(resp.requests[i]);
				}
			}
			delete m_active_polls[poll_id];
			add_poll();
		});
	}

	function handle_request_from_server(req) {
		var request_id=req.request_id;
		if (!request_id) {
			console.warn('No request id in request from server!');
			return;
		}
		m_request_handler(req.cmd,req.query,function(resp) {
			send_response_to_request_from_server(request_id,resp,function(err) {
				if (err) {
					console.error(err+' (trying again in 10 seconds)');
					setTimeout(function() {
						send_response_to_request_from_server(request_id,resp,function(err2) {
							if (err2) {
								console.error(err2+' (failed on second try)');
							}
						});
					},10*1000);
				}
			});
		});
	}

	function send_response_to_request_from_server(request_id,resp,callback) {
		var responses=[];
		responses.push({
			request_id:request_id,
			response:resp
		});
		var url=m_url+'/api/responses-from-container';
		lari_http_post_json(url,{responses:responses,container_id:m_container_id},{},function(err0,resp0) {
			if (err0) {
				callback('Error sending responses to lari server: '+err0);
				return;
			}
			if (!resp0.success) {
				callback('Error in sending responses to lari server: '+resp.error);
				return;
			}
			callback(null);
		});	
	}

	function housekeeping() {
		if (m_running) {
			var num_active_polls=0;
			for (var id in m_active_polls) {
				num_active_polls++;
			}
			if (num_active_polls<1) {
				add_poll();
			}
		}
		setTimeout(function() {
			housekeeping();
		},1000);
	}
	setTimeout(function() {
		housekeeping();
	},500);
}


/*
function decode_jwt(token) {
	var list=token.split('.');
	var str0=list[1]||'';
	return JSON.parse(require('atob')(str0));
}

function create_authorization_jwt(authorization,options) {
	var secret=process.env.KBUCKET_SECRET||'';
	if (!secret) return null;
	return jwt.sign(authorization,secret,options||{});
}
*/

function send_json_response(RESP,obj) {
	RESP.writeHead(200, {"Access-Control-Allow-Origin":"*", "Content-Type":"application/json"});
	RESP.end(JSON.stringify(obj));
}

function receive_json_post(REQ,callback_in) {
	var callback=callback_in;
	var body='';
	REQ.on('data',function(data) {
		body+=data;
	});
	REQ.on('error',function() {
		if (callback) callback(null);
		callback=null;
	})
	
	REQ.on('end',function() {
		var obj;
		try {
			var obj=JSON.parse(body);
		}
		catch (e) {
			if (callback) callback(null);
			callback=null;
			return;
		}
		if (callback) callback(obj);
		callback=null;
	});
}

//not used for now
function do_update_lari_config_if_needed(callback) {
	var elapsed=(new Date())-last_update_lari_config;
	if (elapsed>5000) {
		do_update_lari_config(callback);
	}
	else {
		callback();
	}
}

//not used for now
function do_update_lari_config(callback) {
	do_update_lari_config_2(function(err,obj) {
		last_update_lari_config=new Date();
		if (err) {
			console.error(err);
			if (callback) callback();
		}
		else {
			if (JSON.stringify(obj)!=JSON.stringify(lari_config)) {
				console.info('Setting new lari_config.');
				console.info(JSON.stringify(obj));
				lari_config=obj;
			}
			if (callback) callback();
		}
	});
}

// not used for now
function do_update_lari_config_2(callback) {
	if (!CONFIG_DOC) {
		callback(null,{});
		return;
	}
	var tmp=CONFIG_DOC.split(':');
	if (tmp.length!=2) {
		console.error('Error in CONFIG_DOC: '+CONFIG_DOC);
		process.exit(-1);
	}
	var owner=tmp[0];
	var title=tmp[1];

	var CC=new DocStorClient();
	CC.setDocStorUrl(DOCSTOR_URL);
	CC.findDocuments({owned_by:owner,and_shared_with:'[public]',filter:{"attributes.title":title}},function(err2,tmp) {
		if (err2) {
			callback('Error getting document: '+title+'('+owner+'): '+err2);
			return;
		}
		if (tmp.length===0) {
			callback('Unable to find document: '+title+' ('+owner+')');
			return;	
		}
		if (tmp.length>1) {
			callback('More than one document found with title: '+title);
			return;	
		}
		CC.getDocument(tmp[0]._id,{include_content:true},function(err3,tmp) {
			if (err3) {
				callback('Error retreiving config content of document '+title+': '+err3);
				return;
			}
			var obj=try_parse_json(tmp.content);
			if (!obj) {
				callback('Error parsing json content of config for document '+title);
				return;
			}
			callback(null,obj);
		});
	});
}

function try_parse_json(json) {
	try {
		return JSON.parse(json);
	}
	catch(err) {
		return null;
	}
}

function create_closer(REQ) {
	return REQ||{on:function(str,handler) {}};
}

function lari_make_random_id(len) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for( var i=0; i < len; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}