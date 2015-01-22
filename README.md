# bitcoin-torrent

WARNING: This is only a concept version software for interested developers, not even developer-preview

Bitcoin support for Bittorrent protocol is a way to compensate distributors for their work of hosting & distributing files.
It can be seen as something that Storj wants to be, but using Bitcoin & Bittorrent (2 already widely used protocols).
A Bittorrent node can ask money for transferring pieces of data, and another one can pay for it. A node can be a free downloader/free uploader/money earner/money payer at the same time. A micropayment channel is used for the transaction, which is similar to the Bittorrent tit-for-tat strategy.

As the number one BitTorrent client (uTorrent) is not open source, this project tries to integrate with the upcoming bittorrent client: Popcorn Time (that's why it's written in JavaScript).

The current implementation is only a start. It creates the micropayment channel and transfers the data (although right now very inefficiently), but doesn't yet use the real network. It doesn't have DHT integration or Tracker integration.

TODO:
- package.js
- Use bittorrent protocol between client and server
- Use chain.com API to communicate with the blockchain (this could be switched to bitcoinj SPV wallet in the future)
- Use greenaddress API for instant payment
- Make file transfer fast
- Multiple files support, not only 1 file
- Integrate with Bittorrent download (the same client should be able to download with Bittorrent and with Bitcoin at the same time)
- DHT support
- Tracker client/server
- UI
