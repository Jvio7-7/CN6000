// k6 load test for one cloud. ramps users up/down against /health (read)
// and /users/register (write) so both are measured. pass the target cloud
// and a run tag at runtime, run once per cloud and compare:
//   k6 run -e BASE=https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com -e RUN=aws-run1 loadtest.js
// the run tag goes into the test user emails so runs don't collide.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

const BASE = __ENV.BASE;
const RUN  = __ENV.RUN || `${Date.now()}`;

export const options = {
  scenarios: {
    // read load: lots of GETs against /health
    reads: {
      executor: 'ramping-vus',
      exec: 'readScenario',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },  // ramp up to 20 users
        { duration: '1m',  target: 20 },  // hold
        { duration: '15s', target: 0 },   // ramp down
      ],
    },
    // write load: steadier, lighter - writes are heavier and hit the DB
    writes: {
      executor: 'ramping-vus',
      exec: 'writeScenario',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m',  target: 5 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // 95% of requests under 2s
    http_req_failed:   ['rate<0.05'],    // under 5% errors
  },
};

export function readScenario() {
  const res = http.get(`${BASE}/health`);
  check(res, { 'health 200': (r) => r.status === 200 });
  sleep(1);
}

export function writeScenario() {
  const id = `${RUN}-${__VU}-${__ITER}`;
  const payload = JSON.stringify({
    name: `Load ${id}`,
    email: `load-${id}@test.local`,
    password: 'TestPass123!',
    securityQuestion: 'load test',
    securityAnswer: 'load test',
  });
  const res = http.post(`${BASE}/users/register`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'register 201': (r) => r.status === 201 });
  sleep(1);
}

// Save a full result summary to a tagged file on every run, so results are
// preserved as raw data rather than only a screenshot. The file name carries
// the run tag, so VPC-before and VPC-after runs never overwrite each other.
// k6 also prints the usual summary to the terminal.
export function handleSummary(data) {
  const stamp = RUN;
  const out = {};
  out[`loadtest-summary-${stamp}.json`] = JSON.stringify(data, null, 2);
  out['stdout'] = textSummary(data, { indent: ' ', enableColors: true });
  return out;
}
