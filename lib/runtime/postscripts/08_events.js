// Copyright 2021 the Gigamono authors. All rights reserved. Apache 2.0 license.

"use strict";

((window) => {
  // Optional.
  if (window.__bootstrap.httpEvent == null) {
    return;
  }

  const {
    httpGetRequestHeaders,
    httpGetRequestHeader,
    httpGetRequestUriScheme,
    httpGetRequestUriAuthority,
    httpGetRequestUriPath,
    httpGetRequestUriQuery,
    httpGetRequestMethod,
    httpGetRequestVersion,
    httpGetRequestBodyReadStream,
    httpReadRequestBodyChunk,
    httpSetResponseParts,
    httpSetSendResponseBody,
    httpSetSendResponseBodyWriteStream,
    httpWriteResponseBodyChunk,
    httpGetRequestUriPathQuery,
    httpGetRequestUriHost,
    httpGetRequestUriPort,
  } = window.__bootstrap.httpEvent;
  const { TypeError } = window.__bootstrap.primordials;
  const { Body, Response } = window.__bootstrap.http;

  // This is used as a temp fix for https://github.com/hyperium/hyper/issues/2723
  // From what I know, this problem is only present when you are sending from a response with Body(Full).
  let isRequestBodyRead = false;

  class HttpEventRequest {
    #headers = new HttpEventHeaders();
    #uri = new HttpEventURI();
    #method = new HttpEventMethod();
    #version = new HttpEventVersion();
    #body = new Body();

    constructor() {
      this.#body.setReadStream(() => {
        const rid = httpGetRequestBodyReadStream(); // Creates a read stream.

        return async (buffer) => {
          const total_written = await httpReadRequestBodyChunk(rid, buffer);
          isRequestBodyRead = true;
          return total_written;
        };
      });
    }

    get headers() {
      return this.#headers;
    }

    get uri() {
      return this.#uri;
    }

    get version() {
      return this.#version.value;
    }

    get method() {
      return this.#method.value;
    }

    get body() {
      return this.#body;
    }

    toString() {
      return `Request { method: "${this.#method}", version: "${
        this.#version
      }", uri: "${this.#uri}", headers: ${this.#headers} }`;
    }
  }

  class HttpEventMethod {
    #cache = null;

    get value() {
      if (this.#cache == null) {
        this.#cache = httpGetRequestMethod();
      }

      return this.#cache;
    }

    toString() {
      return this.value;
    }
  }

  class HttpEventVersion {
    #cache = null;

    get value() {
      if (this.#cache == null) {
        this.#cache = httpGetRequestVersion();
      }

      return this.#cache;
    }

    toString() {
      return this.value;
    }
  }

  class HttpEventHeaders {
    #cache = {};

    get value() {
      const kvPairs = httpGetRequestHeaders();
      this.#cache = {
        ...kvPairs,
        ...this.#cache,
      };

      return this.#cache;
    }

    get(key) {
      let value = this.#cache[key];
      if (value == null) {
        value = httpGetRequestHeader(key);
        this.#cache[key] = value;
      }

      return value;
    }

    set(key, value) {
      this.#cache[key] = value;
    }

    toString() {
      return JSON.stringify(this.value);
    }
  }

  class HttpEventURI {
    #cache = {};

    get scheme() {
      if (this.#cache.scheme == null) {
        this.#cache.scheme = httpGetRequestUriScheme();
      }

      return this.#cache.scheme;
    }

    get authority() {
      if (this.#cache.authority == null) {
        this.#cache.authority = httpGetRequestUriAuthority();
      }

      return this.#cache.authority;
    }

    get path() {
      if (this.#cache.path == null) {
        this.#cache.path = httpGetRequestUriPath();
      }

      return this.#cache.path;
    }

    get query() {
      return new HTTPEventQuery();
    }

    get pathQuery() {
      if (this.#cache.pathQuery == null) {
        this.#cache.pathQuery = httpGetRequestUriPathQuery();
      }

      return this.#cache.pathQuery;
    }

    get host() {
      if (this.#cache.host == null) {
        this.#cache.host = httpGetRequestUriHost();
      }

      return this.#cache.host;
    }

    get port() {
      if (this.#cache.port == null) {
        this.#cache.port = httpGetRequestUriPort();
      }

      return this.#cache.port;
    }

    toString() {
      const scheme = this.scheme != null ? `${this.scheme}://` : "";
      const host = this.host || "";
      const port = this.port != null ? `:${this.port}` : "";
      const pathQuery = this.pathQuery || "";

      return `${scheme}${host}${port}${pathQuery}`;
    }
  }

  class HTTPEventQuery {
    #cache = null;

    get value() {
      if (this.#cache == null) {
        this.#cache = httpGetRequestUriQuery();
      }

      return this.#cache;
    }

    get(key) {
      if (this.#cache == null) {
        this.#cache = httpGetRequestUriQuery();
      }

      const key_equal = `${key}=`;

      const index = this.#cache.indexOf(key_equal);
      if (index < 0) {
        return null;
      }

      const sub = this.#cache.slice(index + key_equal.length);
      const matches = sub.match(/^[^&#]+/);

      if (!matches) {
        return null;
      }

      return matches[0];
    }
  }

  function setWriteStream(response) {
    response.body.setWriteStream(async () => {
      const rid = await httpSetSendResponseBodyWriteStream(); // Creates a write stream.

      return async (buffer) => {
        await httpWriteResponseBodyChunk(rid, buffer);
      };
    });
  }

  let request = new HttpEventRequest();

  const http = {
    request,
    respondWith: async function (response) {
      // TODO(appcypher): Send Response as a single chunk. httpSetResponseParts.
      // Response object must be of type Response.
      if (!response instanceof Response) {
        throw new TypeError("expected response to be Response instance");
      }

      // Set response parts.
      httpSetResponseParts({
        status: response.status,
        version: response.version,
        headers: response.headers.value,
      });

      // Set how body is to be handled.
      switch (response.body.writeType) {
        case "file":
        case "asyncIterator": {
          // If the write type is file or asyncIterator, we stream the content. This is transfer encoding chunked in Http/1.1, Body(Streaming) in hyper.
          setWriteStream(response);

          // Drive the response body stream.
          await response.body.writeAll(response.body.writeObject);
          break;
        }
        default: {
          // If the write type is string or typedArray, we use hyper's Body(Full) which means we send the body in a single chunk with Content-Length header.
          // The following if statement is a simple hack for https://github.com/hyperium/hyper/issues/2723.
          if (!isRequestBodyRead) {
            const read = await request.body.getReadStream();
            await read(new Uint8Array(0)); // Reading 0 byte works.
          }

          await httpSetSendResponseBody(response.body.writeObject);
        }
      }
    },
  };

  const events = { http };

  window.__bootstrap.events = { events };
})(globalThis);