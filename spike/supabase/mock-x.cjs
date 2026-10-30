// Minimal stand-in for X's OAuth 2.0 endpoints, enough for supabase/auth's "x" provider:
//   GET  /i/oauth2/authorize -> 302 back to redirect_uri with code+state
//   POST /2/oauth2/token     -> bearer token
//   GET  /2/users/me         -> { data: <current mock user> }
//   POST /__set              -> change the mock user (e.g. rename a handle, keep the id)
const http = require("http");
let user = { id: "2244994945", name: "Doge Fan", username: "DogeFan_42", confirmed_email: "dogefan@example.com", profile_image_url: "https://example.com/a.png", url: "", created_at: "2013-12-14T04:35:55.000Z" };
const log = [];
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  log.push(`${req.method} ${u.pathname}`);
  if (u.pathname === "/i/oauth2/authorize") {
    const back = new URL(u.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "mock-code");
    back.searchParams.set("state", u.searchParams.get("state"));
    res.writeHead(302, { Location: back.toString() }).end();
  } else if (u.pathname === "/2/oauth2/token") {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token_type: "bearer", access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 7200, scope: "users.read tweet.read users.email offline.access" }));
  } else if (u.pathname === "/2/users/me") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: user }));
  } else if (u.pathname === "/__set") {
    let b = "";
    req.on("data", (d) => (b += d)).on("end", () => { user = { ...user, ...JSON.parse(b) }; res.writeHead(200).end(JSON.stringify(user)); });
  } else if (u.pathname === "/__log") {
    res.writeHead(200).end(log.join("\n"));
  } else res.writeHead(404).end();
}).listen(4010, "0.0.0.0", () => console.log("mock X on :4010"));
