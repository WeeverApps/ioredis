import Redis from "../../lib/redis";
import MockServer from "../helpers/mock_server";
import { expect } from "chai";

describe("sentinel", function() {
  describe("connect", function() {
    it("should connect to sentinel successfully", function(done) {
      var sentinel = new MockServer(27379);
      sentinel.once("connect", function() {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master"
      });
    });

    it("should default to the default sentinel port", function(done) {
      var sentinel = new MockServer(26379);
      sentinel.once("connect", function() {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1" }],
        name: "master"
      });
    });

    it("should try to connect to all sentinel", function(done) {
      var sentinel = new MockServer(27380);
      sentinel.once("connect", function() {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        name: "master"
      });
    });

    it("should call sentinelRetryStrategy when all sentinels are unreachable", function(done) {
      var t = 0;
      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        sentinelRetryStrategy: function(times) {
          expect(times).to.eql(++t);
          var sentinel = new MockServer(27380);
          sentinel.once("connect", function() {
            redis.disconnect();
            sentinel.disconnect(done);
          });
          return 0;
        },
        name: "master"
      });
    });

    it("should raise error when all sentinel are unreachable and retry is disabled", function(done) {
      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        sentinelRetryStrategy: null,
        name: "master"
      });

      redis.get("foo", function(error) {
        finish();
        expect(error.message).to.match(/are unreachable/);
      });

      redis.on("error", function(error) {
        expect(error.message).to.match(/are unreachable/);
        finish();
      });

      redis.on("end", function() {
        finish();
      });

      var pending = 3;
      function finish() {
        if (!--pending) {
          redis.disconnect();
          done();
        }
      }
    });

    it("should close the connection to the sentinel when resolving successfully", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        }
      });
      var master = new MockServer(17380);
      sentinel.once("disconnect", function() {
        redis.disconnect();
        master.disconnect(function() {
          sentinel.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master"
      });
    });

    it("should add additionally discovered sentinels when resolving successfully", function(done) {
      var sentinels = [{ host: "127.0.0.1", port: 27379 }];

      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        } else if (argv[0] === "sentinel" && argv[1] === "sentinels") {
          return [
            ["ip", "127.0.0.1", "port", "27379"],
            ["ip", "127.0.0.1", "port", "27380"]
          ];
        }
      });
      var master = new MockServer(17380);
      sentinel.once("disconnect", function() {
        redis.disconnect();
        master.disconnect(function() {
          expect(sentinels.length).to.eql(2);
          sentinel.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: sentinels,
        name: "master"
      });
    });

    it("should skip additionally discovered sentinels even if they are resolved successfully", function(done) {
      var sentinels = [{ host: "127.0.0.1", port: 27379 }];

      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        } else if (argv[0] === "sentinel" && argv[1] === "sentinels") {
          return [
            ["ip", "127.0.0.1", "port", "27379"],
            ["ip", "127.0.0.1", "port", "27380"]
          ];
        }
      });
      var master = new MockServer(17380);
      sentinel.once("disconnect", function() {
        redis.disconnect();
        master.disconnect(function() {
          expect(sentinels.length).to.eql(1);
          expect(sentinels[0].port).to.eql(27379);
          sentinel.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: sentinels,
        updateSentinels: false,
        name: "master"
      });
    });
    it("should connect to sentinel with authentication successfully", function(done) {
      var authed = false;
      var redisServer = new MockServer(17380, function(argv) {
        if (argv[0] === "auth" && argv[1] === "pass") {
          authed = true;
        } else if (argv[0] === "get" && argv[1] === "foo") {
          expect(authed).to.eql(true);
          redisServer.disconnect();
          done();
        }
      });
      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          sentinel.disconnect(done);
          return ["127.0.0.1", "17380"];
        }
      });

      var redis = new Redis({
        sentinelPassword: "pass",
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master"
      });
      redis.get("foo").catch(function() {});
    });
  });

  describe("master", function() {
    it("should connect to the master successfully", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        }
      });
      var master = new MockServer(17380);
      master.on("connect", function() {
        redis.disconnect();
        sentinel.disconnect(function() {
          master.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master"
      });
    });

    it("should reject when sentinel is rejected", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return new Error("just rejected");
        }
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        sentinelRetryStrategy: null,
        lazyConnect: true
      });

      redis
        .connect()
        .then(function() {
          throw new Error("Expect `connect` to be thrown");
        })
        .catch(function(err) {
          expect(err.message).to.eql(
            "All sentinels are unreachable and retry is disabled. Last error: just rejected"
          );
          redis.disconnect();
          sentinel.disconnect(done);
        });
    });

    it("should connect to the next sentinel if getting master failed", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return null;
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on("connect", function() {
        redis.disconnect();
        sentinel.disconnect(function() {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        name: "master"
      });
    });

    it("should connect to the next sentinel if the role is wrong", function(done) {
      new MockServer(27379, function(argv) {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "get-master-addr-by-name" &&
          argv[2] === "master"
        ) {
          return ["127.0.0.1", "17380"];
        }
      });

      var sentinel = new MockServer(27380);
      sentinel.on("connect", function() {
        redis.disconnect();
        done();
      });

      new MockServer(17380, function(argv) {
        if (argv[0] === "info") {
          return "role:slave";
        }
      });

      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        name: "master"
      });
    });
  });

  describe("slave", function() {
    it("should connect to the slave successfully", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [["ip", "127.0.0.1", "port", "17381", "flags", "slave"]];
        }
      });
      var slave = new MockServer(17381);
      slave.on("connect", function() {
        redis.disconnect();
        sentinel.disconnect(function() {
          slave.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        role: "slave",
        preferredSlaves: [{ ip: "127.0.0.1", port: "17381", prio: 10 }]
      });
    });

    it("should connect to the slave successfully based on preferred slave priority", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [
            ["ip", "127.0.0.1", "port", "44444", "flags", "slave"],
            ["ip", "127.0.0.1", "port", "17381", "flags", "slave"],
            ["ip", "127.0.0.1", "port", "55555", "flags", "slave"]
          ];
        }
      });
      var slave = new MockServer(17381);
      slave.on("connect", function() {
        redis.disconnect();
        sentinel.disconnect(function() {
          slave.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        role: "slave",
        // for code coverage (sorting, etc), use multiple valid values that resolve to prio 1
        preferredSlaves: [
          { ip: "127.0.0.1", port: "11111", prio: 100 },
          { ip: "127.0.0.1", port: "17381", prio: 1 },
          { ip: "127.0.0.1", port: "22222", prio: 100 },
          { ip: "127.0.0.1", port: "17381" },
          { ip: "127.0.0.1", port: "17381" }
        ]
      });
    });

    it("should connect to the slave successfully based on preferred slave filter function", function(done) {
      new MockServer(27379, function(argv) {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [["ip", "127.0.0.1", "port", "17381", "flags", "slave"]];
        }
      });
      // only one running slave, which we will prefer
      var slave = new MockServer(17381);
      slave.on("connect", function() {
        redis.disconnect();
        done();
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        role: "slave",
        preferredSlaves(slaves) {
          for (var i = 0; i < slaves.length; i++) {
            var slave = slaves[i];
            if (slave.ip == "127.0.0.1" && slave.port == "17381") {
              return slave;
            }
          }
          return null;
        }
      });
    });

    it("should connect to the next sentinel if getting slave failed", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [];
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on("connect", function() {
        redis.disconnect();
        sentinel.disconnect(function() {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        name: "master",
        role: "slave"
      });
    });

    it("should connect to the next sentinel if the role is wrong", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [["ip", "127.0.0.1", "port", "17381", "flags", "slave"]];
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on("connect", function(c) {
        redis.disconnect();
        sentinel.disconnect(function() {
          slave.disconnect(function() {
            sentinel2.disconnect(done);
          });
        });
      });

      var slave = new MockServer(17381, function(argv) {
        if (argv[0] === "info") {
          return "role:master";
        }
      });

      var redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 }
        ],
        name: "master",
        role: "slave"
      });
    });
  });

  describe("failover", function() {
    it("should switch to new master automatically without any commands being lost", function(done) {
      var sentinel = new MockServer(27379, function(argv) {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        }
      });
      var master = new MockServer(17380);
      master.on("connect", function(c) {
        c.destroy();
        master.disconnect();
        redis.get("foo", function(err, res) {
          expect(res).to.eql("bar");
          redis.disconnect();
          newMaster.disconnect(function() {
            sentinel.disconnect(done);
          });
        });
        var newMaster = new MockServer(17381, function(argv) {
          if (argv[0] === "get" && argv[1] === "foo") {
            return "bar";
          }
        });
        sentinel.handler = function(argv) {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17381"];
          }
        };
      });

      var redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master"
      });
    });
  });
});
