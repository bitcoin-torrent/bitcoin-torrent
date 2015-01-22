// Torrent file sharing
var https = require('https');
var fs = require('fs');
var jayson = require('jayson');
var crypto = require('crypto')
var parseTorrent = require('parse-torrent')
var bitcoin = require('bitcoinjs-lib')
var assert = require('node-assertthat')
_ = require('underscore')
var Chain = require('chain-node')
var rw = require('rw')
chain = new Chain({keyId: 'DEMO-4a5e1e4'})

/*
  Zero trust protocol to download a file from a server using the bittorrent info hash and paying with Bitcoin with prototype implementation.
  The protocol uses a micro-channel between the client and the server.
  It's very similar to https://bitcoinj.github.io/working-with-micropayments, but intended to work together with
  Bittorrent. Bittorrent Tracker & DHT function is not yet implemented, but it's the right direction.
  The code could be integrated to Popcorn time, as it uses Javascript and the same libraries.
  
  The client connects to the server, asks for information about the Bittorrent file using the info hash
  getInfoAndTorrentFile: client -> server    (infohash)
  The server returns with the file size, the price and the torrent file (to prove that it has the torrent file,
    a destination address, and the server-controlled multisig address.
   server -> client  (fileSize, price, torrentFile, serverPubAddress, serverPubMultiAddress)
  
  The client checks the bittorrent file and prepares the micro-channel transaction:
  it creates the client part of the multisig transaction,
  it creates an initial bitcoin transaction using greenaddress.it API (sending price + transaction fee money with a tranaction fee added) that
    sends money from client wallet to the multisig address.
  It doesn't yet sign the transaction.
  It also creates and signs the refund transaction with nLockTime of 6*24 blocks (about 1 day) from the multikey address to the wallet of the client.
  It sends the refund transaction for being signed by the server
  
  signRefundTransaction: client -> server (refundTransaction, refundTransactionClientSignature, clientPubMultiAddress)
  
  the server verifies the refund transaction with redeemScript signature (the script is OP_2 clientPubAddress serverPubAddress OP_2 OP_CHECKMULTISIG)
  
  server -> client ( refundTransactionServerSignature)
  
  the client signs and publishes the initial transaction and the refund transaction . (signing is done by the user of greenaddress?)

  Client shows proof of initial transaction
  
  verifyInitTransaction: client -> server (signedInitTransaction)
  
  Server checks the proof with greenaddress. If greenaddress accepts it as an instant transaction, the server confirms the verification.
     If greenaddress verification fails, the server publishes the transaction on the blockchain and waits for the transaction to be confirmed.

   After the verification is successful, the server stores the verified multisig address and replies with OK. It also sends the first piece as a proof of bandwidth.
     (the client already spent 2 transaction fees).
  
  server->client (firstPiece)
  
  From now on the client can ask for pieces and the server sends them back as long as it has money.
  The clients sends money and asks for pieces, the server replies with the pieces. The client needs to pay for the 1st piece from the initial transaction as well,
    and all pieces cost the same amount of money. Right now this is a pull model, but the data transfer should work all the time as long as there's money,
	and money amount should be updated by the client before the client finishes sending the pieces that it can from the budget (which requires a push model from the client).
	Also it should work together with the Bittorrent protocol (for example slow uploads could be allowed for free), and JSON-RPC should be switched to Bittorrent-RPC.

  getPieces client->server (transactionWithMoney, clientSignature, piecesToRetrieve)
  
  the server computes how many pieces can be sent from the total amount of money that is given, subtracts the number of pieces that are already sent,
    and returns the pieces that can be sent.
	
	server->client (pieces)
  
  the client finalizes the transaction:
    finalizeTransaction client->server(transactionWithMoney, clientSignature)
	
  the server signs the transaction, publishes to the blockchain and replies with the signed transaction
  
  server->client (serverSignature)
  
  6 blocks before the refund transaction if the transaction wasn't finalized, the server publishes the best transaction it has to the blockchain.
   

*/


// Gets current bitcoin blockchain block height and calls f with block height
/*function getBlockHeight(f) {
	var options = {
	  hostname: 'blockchain.info',
	  port: 443,
	  path: '/latestblock',
	  method: 'GET'
	};
  var req = https.get(options, function(res) {
  data = "";

  res.on('data', function(d) {
	data = data+d;
  });
    res.on('end', function() {
		console.log(data)
       j = JSON.parse(data)
       f(j["height"])
  });

	});
	req.on('error', function(e) {
	  console.error(e);
	});

}*/

txcost = 10000

// Callback to save torrent file..currently it just writes blocks in an open file
function newTorrentSaver(file) {
	return(fs.openSync(file, 'w'))
}

function torrentSaverGotData(torrentSaver, block, blockSize, data) {
	fs.writeSync(torrentSaver, data, 0, data.length, block*blockSize) 
}
function torrentSaverClose(torrentSaver) {
	fs.closeSync(torrentSaver)
}


function getBlockHeight(f) {
	chain.getLatestBlock(function(err, resp) {
		f(resp.height)
	})
}

	//getPiece(client, parsedTorrent, 1, clientMultiAddress, serverPubMultiKey, serverPubAddress, torrentSaver)

function getPiece(client, parsedTorrent, piece, clientMultiAddress, serverPubMultiKey, serverPubAddress, torrentSaver,
		initTransaction, price) {
  // Pay for piece
			
	payedTransaction = new bitcoin.TransactionBuilder()
	payedTransaction.addInput(initTransaction.getHash(), initAmountSatoshis, 54, initTransaction.outs[0].script)
	totalOutSatoshis = initAmountSatoshis-txcost
	payedSatoshis = Math.floor(100000000*price*(piece+1)/(parsedTorrent['pieces'].length))
	payedTransaction.addOutput(serverPubAddress, payedSatoshis)
	payedTransaction.addOutput(clientAddress.pub.getAddress(), totalOutSatoshis-payedSatoshis)
	payedTransaction.sign(0, clientMultiAddress)

	client.request('getPieces', 
			[[piece], payedTransaction.buildIncomplete().toHex(), initTransaction.outs[0].script,
			clientMultiAddress.pub.toBuffer()],
			function(err, error, blockDatas) {
		blockDataBuffer = new Buffer(blockDatas['pieces'][0])
		assert.equal(parsedTorrent['pieces'][piece], sha1(blockDataBuffer, 'hex'))
		torrentSaverGotData(torrentSaver, piece, parsedTorrent['pieceLength'], blockDataBuffer)
		if (piece+1 < (parsedTorrent['pieces'].length)) {
			getPiece(client, parsedTorrent, piece+1, clientMultiAddress, serverPubMultiKey, serverPubAddress,
					torrentSaver, initTransaction, price)
		} else {
			torrentSaverClose(torrentSaver)
			console.log("Done")
		}
	})
}

function createMultiScript(pub1, pub2) {
  return bitcoin.Script.fromChunks([
	bitcoin.opcodes.OP_2,
	pub1.toBuffer(), pub2.toBuffer(),
	bitcoin.opcodes.OP_2,
	bitcoin.opcodes.OP_CHECKMULTISIG
  ])
}
function multiAddrScriptBC(script) {
	console.log(script)
	return(new bitcoin.Address(script.getHash(),5).toBase58Check())
}


function getInitTransactionFromGreenAddress(outputScript, valueSatoshis,callback) {
	tx = new bitcoin.Transaction()
	tx.addInput("aa94ab02c182214f090e99a0d57021caffd0f195a81c24602b1028b130b63e31", 0)
	tx.addOutput(outputScript, valueSatoshis)

	callback(tx)
}

// Push transaction to the network
function pushTransaction(transaction) {
}

function signInitTransactionWithGreenAddress(initTransaction, callback) {
	signedTransaction = initTransaction
	callback(signedTransaction)
}

download = function(infoHash, hostname, port) {
	var client = jayson.client.http({
	  port: port,
	  hostname: hostname
	});
	
	/*
  
  verifyInitTransaction: client -> server (signedInitTransaction)
  
  Server checks the proof with greenaddress. If greenaddress accepts it as an instant transaction, the server confirms the verification.
     If greenaddress verification fails, the server publishes the transaction on the blockchain and waits for the transaction to be confirmed.

   After the verification is successful, the server stores the verified multisig address and replies with OK. It also sends the first piece as a proof of bandwidth.
     (the client already spent 2 transaction fees).
  
  server->client (firstPiece)
  
  From now on the client can ask for pieces and the server sends them back as long as it has money.
  The clients sends money and asks for pieces, the server replies with the pieces. The client needs to pay for the 1st piece from the initial transaction as well,
    and all pieces cost the same amount of money. Right now this is a pull model, but the data transfer should work all the time as long as there's money,
	and money amount should be updated by the client before the client finishes sending the pieces that it can from the budget (which requires a push model from the client).
	Also it should work together with the Bittorrent protocol (for example slow uploads could be allowed for free), and JSON-RPC should be switched to Bittorrent-RPC.

  getPieces client->server (transactionWithMoney, clientSignature, piecesToRetrieve)
  
  the server computes how many pieces can be sent from the total amount of money that is given, subtracts the number of pieces that are already sent,
    and returns the pieces that can be sent.
	
	server->client (pieces)
  
  the client finalizes the transaction:
    finalizeTransaction client->server(transactionWithMoney, clientSignature)
	
  the server signs the transaction, publishes to the blockchain and replies with the signed transaction
  
  server->client (serverSignature)
  */
	clientMultiAddress = bitcoin.ECKey.makeRandom()
	clientPubMultiKey = clientMultiAddress.pub
	clientPubMultiAddress = clientMultiAddress.pub.getAddress()
	clientAddress = bitcoin.ECKey.makeRandom()

		
	console.log('getting info')
	client.request('getInfoAndTorrentFile', [infoHash, clientPubMultiKey.toBuffer()], 
	// Client gets address from server to pay money to and price for downloading a file
	// (also data size, number of blocks)
	function(err, error, data) {
		console.log( _.keys(data))
		price = data["price"]
		console.log(price)
		console.log(data["serverPubMultiKey"])
		torrentFile = new Buffer(data["torrentFile"])
		console.log(torrentFile)
		parsedTorrent = parseTorrent(torrentFile)
		//console.log(parsedTorrent)
		assert(infoHash===parsedTorrent['infoHash'])
		fileSize = parsedTorrent["fileSize"]
		pieceLength = parsedTorrent['pieceLength']


		serverPubAddress = bitcoin.Address.fromBase58Check(data["serverPubAddress"])
		serverPubMultiKey = bitcoin.ECPubKey.fromHex(data["serverPubMultiKey"])
		numberOfPieces = parsedTorrent['pieces'].length

		multiAddrScript = createMultiScript(clientPubMultiKey, serverPubMultiKey)
		initAmountSatoshis = Math.floor((price + 0.0001)*100000000)
		getInitTransactionFromGreenAddress(multiAddrScript, initAmountSatoshis, function(initTransaction) {
		console.log("Pay " + (price + 0.0001) + " Bitcoins to " + multiAddrScriptBC(multiAddrScript))
			// Lock for 6*24 blocks
			getBlockHeight(function(blockHeight) {
				refundTransaction = new bitcoin.TransactionBuilder()
				refundTransaction.addInput(initTransaction.getHash(), initAmountSatoshis, 54, initTransaction.outs[0].script)
				refundTransaction.addOutput(clientAddress.pub.getAddress(), initAmountSatoshis-txcost)
				refundTransaction.tx.locktime = blockHeight+6*24
				refundTransaction.sign(0, clientMultiAddress)
				console.log(refundTransaction)
				
				console.log("refund transaction: " + refundTransaction.buildIncomplete().toHex())
				// Tell server to sign transaction and wait for signing of transaction by server
				client.request('signRefundTransaction',
						[refundTransaction.buildIncomplete().toHex(), clientPubMultiKey.toBuffer(),
						initTransaction.outs[0].script.toHex()], function(err, error, data2) {
					refundTransactionComplete = bitcoin.Transaction.fromHex(data2["refundTransactionComplete"])
					signInitTransactionWithGreenAddress(initTransaction, function(initTransactionSignature) {
						pushTransaction(initTransaction)
						pushTransaction(refundTransaction)

						// Get torrent file
						client.request('verifyInitTransaction', [initTransaction.toHex(), clientPubMultiKey.toBuffer()],
								function(err, error, data3) {
							firstPiece = data3["firstPiece"]
							pieceBuffer = new Buffer(firstPiece)
							assert.equal(parsedTorrent['pieces'][0], sha1(pieceBuffer, 'hex'))
							
							torrentSaver = newTorrentSaver("out.mp3")
							torrentSaverGotData(torrentSaver, 0, pieceLength, pieceBuffer)

							getPiece(client, parsedTorrent, 1, clientMultiAddress, serverPubMultiKey, serverPubAddress, torrentSaver,
								initTransaction, price)
						})
					})
				})
			})
		})
	});

}

if (process.argv[2] === "download") {
  download("84ff6852c23bf69101934685fb557d84e560143b", "localhost",  5632)
}

function receiveBlock(multiAddr, subAddr, infoHash, fileSize, price, numberOfBlocks, lastPayedTransaction) {
  return(function(block, payedTransaction, timeout) {
    check(payedTransaction.inputs === 1)
	check(payedTransaction.inputs[0] === multiAddr)
	check(payedTransaction.outputs.size() == 2)
	check(payedTransaction.outputs[1] === subAddr)
	check(payedTransaction.nLockTime === 0)
	check(payedTransaction.price >= price * ((block+1)/numberOfBlocks))
	// Compute best payed transaction
	if (lastPayedTransaction == null || lastPayedTransaction.outs[1] < payedTransaction.outs[1]) {
		bestPayedTransaction = payedTransaction
	} else {
		bestPayedTransaction = lastPayedTransaction
	}
    if(timeout) {
		pushTransaction(bestPayedTransaction)
	} else {
		readData(torrentFile, block, function(data) {
		  replyWithData(clientconn, data, receiveBlock(multiAddr, subAddr, infoHash, fileSize, price, numberOfBlocks, serverMultiKey, bestPayedTransaction))
		})
	}
  })
}

function sha1(data, encoding) {
  var shasum = crypto.createHash('sha1');
  shasum.update(data)
  return shasum.digest(encoding)
}

function getFileSize(fileName) {
 var stats = fs.statSync(fileName)
 return(stats["size"])
}

function getPieces(torrentFile) {
  p = parseTorrent(torrentFile)
  return(p['pieces'])

}
function getNumberOfPieces(torrentFile) {
  return(getPieces(torrentFile).length)
 }
 
 function verifyGreenAddressInstant(tx, callback) {
	callback(true)
 }
 
upload = function(filename, torrentFileName, port, serverPubAddress) {
  torrentFile = fs.readFileSync(torrentFileName)
  wholeFile = fs.readFileSync(filename)
  fileSize = getFileSize(filename)
  // $0.2/GB to pay for server fees, $215/BTC
  price = fileSize * 0.2/215/1000000000
  parsedTorrent = parseTorrent(torrentFile)
  console.log(parsedTorrent)
  assert.strictEqual(parsedTorrent['length'], fileSize)
  infoHash = parsedTorrent['infoHash']
  pieceLength = parsedTorrent['pieceLength']
  lastPieceLength = parsedTorrent['lastPieceLength']
  pieces = parsedTorrent['pieces']
  numberOfPieces = parsedTorrent['pieces'].length
  console.log("serving " + filename + " with infoHash " + infoHash + ", file size: " + fileSize +
	", price: " + price + " BTC, pieces: " + numberOfPieces)
  
  peerData = {}
  
  var server = jayson.server({
		getInfoAndTorrentFile: function(clientInfoHash, clientPubMultiKey, callback) {
			console.log('asked for info for '+clientInfoHash)
			console.log('my info is ' + infoHash)
			serverMultiKey = bitcoin.ECKey.makeRandom()
			serverPubMultiKey = serverMultiKey.pub
			serverPubMultiAddress = serverPubMultiKey.getAddress().toString()
			if (peerData[clientPubMultiKey]) {
			  callback(null, {error: "clientPubMultiKey.toBuffer() already in use"})
			  return
			}
			peerData[clientPubMultiKey] = {serverPubMultiKey: serverPubMultiKey, serverMultiKey: serverMultiKey,
					serverPubAddress: serverPubAddress}
			// Read start data request
			if(clientInfoHash === infoHash) {
				console.log('returning data')
				callback(null, {price: price, serverPubAddress: serverPubAddress,
						serverPubMultiKey: serverPubMultiKey.toHex(),
						torrentFile: torrentFile})
				console.log('callback called')
			} else {
				callback(null, {error: "NotFound"})
			}
		},
				
		
		signRefundTransaction: function(refundTransactionHex, clientPubMultiKey, redeemScript, callback) {
				data = peerData[clientPubMultiKey]
				refundTransaction = bitcoin.Transaction.fromHex(refundTransactionHex)
				refundTxb = bitcoin.TransactionBuilder.fromTransaction(refundTransaction)
				refundTxb.tx.locktime = refundTransaction.locktime // Bug in bitcoinjs-lib
				refundTxb.prevOutTypes['0'] = 'multisig'
				refundTxb.prevOutScripts['0']=bitcoin.Script.fromHex(redeemScript)
				console.log(refundTxb)
				getBlockHeight(function(blockHeight) {
					assert.that(refundTxb.tx.locktime, is.atLeast(blockHeight + 6*24-2))
					serverMultiKey = data["serverMultiKey"]
					refundTxb.sign(0, serverMultiKey)
					refundTransactionComplete = refundTxb.build()
					callback(null, {refundTransactionComplete: refundTransactionComplete.toHex()})
					  
				})
			},
			
			
		verifyInitTransaction: function(signedInitTransaction, clientPubMultiKey, callback) {
		    data = peerData[clientPubMultiKey]
			serverPubMultiKey = data["serverPubMultiKey"]
			tx = bitcoin.Transaction.fromHex(signedInitTransaction)
			multiScript = createMultiScript(bitcoin.ECPubKey.fromHex(clientPubMultiKey), serverPubMultiKey)
			console.log('out script')
			console.log(tx.outs[0].script)
			console.log(tx.outs[0].script.toString())

			assert.deepEqual(tx.outs[0].script.getHash(), multiScript.getHash())
			assert.that(tx.outs[0].value, is.atLeast(price/numberOfPieces-0.0000001))
			data["available"] = tx.outs[0].value
			data["used"] = price/numberOfPieces

			verifyGreenAddressInstant(tx, function(isInstant) {
				assert(isInstant)
				data["verified"] = true
				console.log(pieceLength)
				firstPiece = wholeFile.slice(0, pieceLength)
				console.log(torrentFile.length)
				console.log(firstPiece.length)
				callback (null, {firstPiece: firstPiece})
			})
		},

		 getPieces: function (piecesToRetrieve, transactionWithMoneyHex, redeemScript, clientPubMultiKey, callback) {
		    data = peerData[clientPubMultiKey]
			assert(data["verified"])
		    usedNow = price*piecesToRetrieve/numberOfPieces
			assert.that(data["available"]-data["used"], is.atLeast(usedNow-0.0000001))
			data["used"] = data["used"] + usedNow
			pieces = []
			for (i = 0; i < piecesToRetrieve.length; i++) {
				pieces[i] = wholeFile.slice(piecesToRetrieve[i]*pieceLength, (piecesToRetrieve[i]+1)*pieceLength)
			}
			callback(null, {pieces: pieces})
		},
  
		finalizeTransaction: function(transactionWithMoney, clientSignature, callback) {
			callback (null, {serverSignature: serverSignature})
		}			
  })
  server.http().listen(port)
}


if (process.argv[2] === "upload") {

upload("C:\\Users\\Adam\\Downloads\\FDR_2761_Bitcoin_vs_War.mp3",
       "C:\\Users\\Adam\\Downloads\\FDR_2761_Bitcoin_vs_War.mp3.torrent",
	   5632, '1K9pU5cFZR9hSZibApGR35XyH1fj1rnC7U')
	   
}
