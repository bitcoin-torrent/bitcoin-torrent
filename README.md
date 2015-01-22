# bitcoin-torrent

WARNING: This is only a concept version software for interested developers, not even developer-preview

I'm not working on this code-base, as the project is too big for me to be done alone as a hobby project. Still, I think it's doable in a few man-months. If you want to work on it as a hobby project (very good for learning about Bittorrent and Bitcoin as well), just open an issue/fork & send me a pull request.

Bitcoin support for Bittorrent protocol is a way to compensate distributors for their work of hosting & distributing files.
It can be seen as something that Storj wants to be, but using Bitcoin & Bittorrent (2 already widely used protocols).
A Bittorrent node can ask money for transferring pieces of data, and another one can pay for it. A node can be a free downloader/free uploader/money earner/money payer at the same time. A micropayment channel is used for the transaction, which is similar to the Bittorrent tit-for-tat strategy. With this method, and current internet transfer fees, a video could be downloaded for less than 1 cent/Gigabyte, which could compete with youtube if people would pay 1 cent to see a video that doesn't have ads.

As the number one BitTorrent client (uTorrent) is not open source, this project tries to integrate with the upcoming bittorrent client: Popcorn Time (that's why it's written in JavaScript).

The current implementation is only a start. It creates the micropayment channel and transfers the data (although right now very inefficiently), but doesn't yet use the real network. It doesn't have DHT integration or Tracker integration.

TODO:
- package.js
- Use bittorrent protocol between client and server
- Use chain.com API to communicate with the blockchain (this could be switched to bitcoinj SPV wallet in the future)
- Use greenaddress API for instant payment
- Use bitcore payment channel to simplify code
- Make file transfer fast
- Multiple files support, not only 1 file
- Integrate with Bittorrent download (the same client should be able to download with Bittorrent and with Bitcoin at the same time)
- DHT support
- Tracker client/server
- UI
