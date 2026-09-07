# Video surveillance prototype

Node.js take-home: fake RTSP camera, Server A (video), Server B (login / commands), browser UI.

Needs Node 20+. First start downloads MediaMTX (needs network once).

```bash
npm install
npm start
```

Then open http://127.0.0.1:3000- docs are at http://127.0.0.1:3000/docs

`npm start` brings up MediaMTX, the camera, A, and B, and restarts them if they die.

Log in as `admin` / `admin123` or `operator` / `operator123` (both operators). `viewer` / `viewer123` can watch, GET_STATUS, and LOGOUT, but not start or stop. Passwords are bcrypt hashes in `users.json`; regen with `npm run generate-users`.

In the console: START_VIDEO, STOP_VIDEO, GET_STATUS, LOGOUT. Those go out encrypted (writeup is in SOLUTION.md). `commands.log` is HMAC-chained; `npm run verify-log` checks it.

RTSP is `rtsp://127.0.0.1:1111/camera`. B is :3000, A's video socket is `ws://127.0.0.1:3001/stream`, A->B B<-A control is TCP :4000.

You can set `JWT_SECRET`. If you don't, it uses the hardcoded dev secret, which is fine for a local demo.

Longer notes: [SOLUTION.md](SOLUTION.md)
