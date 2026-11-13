/*
 * turing.js - the machine the rack is claimed to be able to run.
 *
 * Chapter 12 rests on an embedding: if the rack can carry out any Turing
 * machine then it is, in the useful sense, general purpose. A claim like that
 * is worth testing rather than asserting, so this module does two things:
 *
 *   1. a plain Turing machine, with a tape and a transition table, that can
 *      be stepped and run;
 *   2. simulateOnRack(), which runs that same machine with its tape held in
 *      cache blocks and its state held in an L1 block, so the embedding is
 *      executed rather than described.
 */

let runCounter = 0;

export class TuringMachine {
  constructor(spec) {
    this.states = spec.states || [];
    this.alphabet = spec.alphabet || [];
    this.blank = spec.blank != null ? spec.blank : '_';
    /* transitions: "state,symbol" -> [write, move, next] */
    this.transitions = spec.transitions || {};
    this.start = spec.start || (this.states[0] || 'q0');
    this.accept = spec.accept || 'q_accept';
    this.reject = spec.reject || 'q_reject';
    this.reset(spec.tape || '');
  }

  reset(tape) {
    const chars = typeof tape === 'string' ? tape.split('') : Array.from(tape || []);
    this.tape = chars.length ? chars : [this.blank];
    this.head = 0;
    this.state = this.start;
    this.steps = 0;
    this.halted = false;
    this.result = null;
    return this;
  }

  cell(i) {
    if (i < 0 || i >= this.tape.length) return this.blank;
    return this.tape[i];
  }

  write(i, ch) {
    while (i >= this.tape.length) this.tape.push(this.blank);
    if (i < 0) return;
    this.tape[i] = ch;
  }

  /* One transition. Returns false once the machine has halted. */
  step() {
    if (this.halted) return false;
    const symbol = this.cell(this.head);
    const rule = this.transitions[this.state + ',' + symbol];
    if (!rule) {
      this.halted = true;
      this.result = this.state === this.accept ? 'accept' : 'reject';
      return false;
    }
    this.write(this.head, rule[0]);
    const move = rule[1] === 'L' ? -1 : rule[1] === 'R' ? 1 : 0;
    this.head += move;
    /* The tape is unbounded to the left too: grow it and keep the head on the
     * new cell. Clamping here would make any left-walking program loop. */
    if (this.head < 0) {
      this.tape.unshift(this.blank);
      this.head = 0;
    }
    this.state = rule[2];
    this.steps++;
    if (this.state === this.accept || this.state === this.reject) {
      this.halted = true;
      this.result = this.state === this.accept ? 'accept' : 'reject';
    }
    return true;
  }

  run(maxSteps) {
    const limit = maxSteps || 100000;
    while (this.steps < limit && this.step()) { /* keep stepping */ }
    if (!this.halted) this.result = 'timeout';
    return {
      result: this.result,
      steps: this.steps,
      state: this.state,
      tape: this.tape.join(''),
      head: this.head
    };
  }
}

/*
 * A machine that adds one to a binary number: walk to the rightmost bit,
 * carry leftwards while the bits are 1, flip the first 0, then walk home.
 * It is the smallest program that still needs unbounded carry - the reason
 * the tape, and not a register, is the right primitive.
 */
export function binaryIncrementMachine() {
  return new TuringMachine({
    states: ['seek', 'carry', 'q_accept'],
    alphabet: ['0', '1', '_'],
    blank: '_',
    start: 'seek',
    accept: 'q_accept',
    reject: 'q_reject',
    transitions: {
      'seek,0': ['0', 'R', 'seek'],
      'seek,1': ['1', 'R', 'seek'],
      'seek,_': ['_', 'L', 'carry'],
      'carry,1': ['0', 'L', 'carry'],
      'carry,0': ['1', 'N', 'q_accept'],
      'carry,_': ['1', 'N', 'q_accept']
    }
  });
}

export function binaryIncrement(bits) {
  const tape = String(bits).replace(/[^01]/g, '');
  if (!tape) return { result: 'reject', steps: 0, tape: '', head: 0 };
  return binaryIncrementMachine().reset(tape).run(10000);
}

/* A recogniser for strings of the form 0^n 1^n - needs the tape as a
 * scratchpad, and is the classic witness that this is not a finite state
 * machine dressed up. */
export function equalZeroOneMachine() {
  return new TuringMachine({
    states: ['mark0', 'find1', 'back', 'check', 'q_accept', 'q_reject'],
    alphabet: ['0', '1', 'x', 'y', '_'],
    blank: '_',
    start: 'mark0',
    accept: 'q_accept',
    reject: 'q_reject',
    transitions: {
      'mark0,0': ['x', 'R', 'find1'],
      'mark0,y': ['y', 'R', 'mark0'],
      'mark0,_': ['_', 'L', 'check'],
      'mark0,x': ['x', 'R', 'mark0'],
      'find1,0': ['0', 'R', 'find1'],
      'find1,y': ['y', 'R', 'find1'],
      'find1,1': ['y', 'L', 'back'],
      'find1,_': ['_', 'L', 'q_reject'],
      'back,0': ['0', 'L', 'back'],
      'back,x': ['x', 'R', 'mark0'],
      'back,y': ['y', 'L', 'back'],
      'check,x': ['x', 'L', 'check'],
      'check,y': ['y', 'L', 'check'],
      'check,_': ['_', 'R', 'q_accept']
    }
  });
}

/*
 * The embedding itself: tape cells live in cache blocks, the head position
 * and the current state live in one block pinned at L1. Every step is a
 * cache read and a cache write, so the run is also a workload - the tiers
 * migrate as the machine walks its tape.
 */
export function simulateOnRack(cache, machine, tape, maxSteps) {
  const m = machine.reset(tape);
  /* Cells are addressed with an offset so a program that walks off the left
   * end still maps to a real block: logical cell i lives at PAD + i. */
  const PAD = 1024;
  /* Every run gets its own namespace. Cells are cache blocks, and blocks
   * survive: without a run id a second program would start on the previous
   * program's tape and read its leftovers as its own blank cells. */
  const run = 'sim' + (++runCounter) + ':';
  const cellKey = (i) => run + 'tape:' + (PAD + i);

  /* Load the tape. Without this the rack executes the program over blanks. */
  for (let i = 0; i < m.tape.length; i++) {
    cache.put(cellKey(i), m.tape[i], { bytes: 1, level: 6 });
  }
  let lo = 0;
  let hi = m.tape.length - 1;

  const stateKey = run + 'machine:state';
  cache.put(stateKey, m.state, { bytes: 8, level: 1 });

  const limit = maxSteps || 10000;
  let steps = 0;
  while (steps < limit) {
    const cellKeyNow = cellKey(m.head);
    if (!cache.has(cellKeyNow)) cache.put(cellKeyNow, m.blank, { bytes: 1, level: 6 });
    if (m.head < lo) lo = m.head;
    if (m.head > hi) hi = m.head;

    /* Read: the head cell and the state, both through the cache. */
    const cellBlock = cache.get(cellKeyNow);
    const stateBlock = cache.get(stateKey);
    if (!cellBlock || !stateBlock) return { result: 'fault', steps: steps };
    cache.touch(cellBlock);
    cache.touch(stateBlock);
    const symbol = String(cellBlock.data);
    const rule = m.transitions[stateBlock.data + ',' + symbol];
    if (!rule) {
      m.halted = true;
      m.result = m.state === m.accept ? 'accept' : 'reject';
      break;
    }
    /* Write: tape cell, then the state block. */
    cache.put(cellKeyNow, rule[0], { bytes: 1 });
    cache.consider(cache.get(cellKeyNow));
    const move = rule[1] === 'L' ? -1 : rule[1] === 'R' ? 1 : 0;
    m.head += move;
    m.write(m.head, m.cell(m.head));
    m.state = rule[2];
    cache.put(stateKey, m.state, { bytes: 8, level: 1 });
    m.steps++;
    steps++;
    if (m.state === m.accept || m.state === m.reject) {
      m.halted = true;
      m.result = m.state === m.accept ? 'accept' : 'reject';
      break;
    }
  }
  if (!m.halted) m.result = 'timeout';

  /* Read the tape back out of the cache rather than from the machine's own
   * array - on a rack the cache is the only source of truth. */
  let out = '';
  for (let i = lo; i <= hi; i++) {
    const b = cache.get(cellKey(i));
    out += b ? String(b.data) : m.blank;
  }
  return {
    result: m.result || 'timeout',
    steps: m.steps,
    state: m.state,
    tape: trim(out, m.blank),
    head: m.head,
    cache: cache.stats()
  };
}

/* Leading and trailing blanks are padding, not tape content. */
function trim(s, blank) {
  let a = 0, b = s.length;
  while (a < b && s[a] === blank) a++;
  while (b > a && s[b - 1] === blank) b--;
  return s.slice(a, b);
}

/*
 * The embedding check: the two implementations - the plain machine and the
 * one running on the rack - must agree on tape, result and state. If they do,
 * the rack executed the program; if they differ, the cache is not a faithful
 * tape and the claim in chapter 12 does not hold for this build.
 */
export function verifyEmbedding(cache, makeMachine, tape, maxSteps) {
  const plain = makeMachine().reset(tape).run(maxSteps || 10000);
  const onRack = simulateOnRack(cache, makeMachine(), tape, maxSteps || 10000);
  return {
    ok: trim(plain.tape, '_') === trim(onRack.tape, '_') && plain.state === onRack.state,
    plain: plain,
    rack: onRack
  };
}
