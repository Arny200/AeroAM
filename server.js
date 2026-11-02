"use strict";

const express = require("express");
const path = require("node:path");

const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = "0.0.0.0";
const publicDirectory = __dirname;
const staticOptions = {
  dotfiles: "ignore",
  etag: true,
  maxAge: "1h",
  setHeaders(response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  }
};

app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.status(200).type("text/plain").send("ok");
});

app.get(["/", "/index.html"], (_request, response, next) => {
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile(path.join(publicDirectory, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.get("/app.js", express.static(publicDirectory, staticOptions));
app.get("/styles.css", express.static(publicDirectory, staticOptions));

app.use((_request, response) => {
  response.status(404).type("text/plain").send("Not found");
});

app.listen(port, host, () => {
  console.log(`AeroAM listening on http://${host}:${port}`);
});
