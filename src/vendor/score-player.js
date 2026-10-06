(function (global) {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);
  const DEFINITIONS = {
    'piano-c3': { file: 'piano-c3.wav', root: 48 },
    'piano-c4': { file: 'piano-c4.wav', root: 60 },
    'piano-c5': { file: 'piano-c5.wav', root: 72 },
    'strings-a4': { file: 'strings-a4.wav', root: 69 },
    'pluck-a4': { file: 'pluck-a4.wav', root: 69 }
  };
  const bytesCache = new Map();
  const decodedCache = new Map();
  const INSTRUMENTS = ['piano', 'pluck', 'strings', 'bass', 'percussion'];

  function normalize(timeline) {
    if (!Array.isArray(timeline)) throw new Error('音源には秒単位の timeline 配列を渡してください。');
    return timeline.map((event, index) => {
      if (!Number.isFinite(event.at) || event.at < 0 || !Number.isFinite(event.duration) || event.duration < 0) {
        throw new Error('timeline[' + index + '] の at / duration が不正です。');
      }
      const notes = event.notes || [];
      if (!Array.isArray(notes) || notes.some(note => !Number.isFinite(note) || note < 0 || note > 127)) {
        throw new Error('timeline[' + index + '] の notes は MIDI 0〜127 の配列で指定してください。');
      }
      const instrument = event.instrument || 'piano';
      if (!INSTRUMENTS.includes(instrument)) throw new Error('不明な音色です: ' + instrument);
      return Object.assign({}, event, { instrument, notes: [...notes].sort((a, b) => a - b), _order: index });
    }).sort((a, b) => a.at - b.at || a._order - b._order);
  }

  function totalDuration(timeline, override) {
    if (override !== undefined) {
      if (!Number.isFinite(override) || override < 0) throw new Error('duration は0以上の秒数を指定してください。');
      return override;
    }
    return timeline.reduce((end, event) => Math.max(end, event.at + event.duration), 0);
  }

  function sampleKey(instrument, midi) {
    if (instrument === 'percussion') return null;
    if (instrument === 'strings') return 'strings-a4';
    if (instrument === 'pluck') return 'pluck-a4';
    if (instrument === 'bass') return 'piano-c3';
    return midi < 54 ? 'piano-c3' : midi < 66 ? 'piano-c4' : 'piano-c5';
  }

  function sampleUrl(key, options) {
    if (options.sampleUrls && options.sampleUrls[key]) return options.sampleUrls[key];
    return (options.sampleBaseUrl || './audio-assets/').replace(/\/?$/, '/') + DEFINITIONS[key].file;
  }

  async function loadSamples(context, timeline, options) {
    const keys = [...new Set(timeline.flatMap(event => event.notes.map(note => sampleKey(event.instrument, note))).filter(Boolean))];
    const pairs = await Promise.all(keys.map(async key => {
      const url = sampleUrl(key, options);
      if (!bytesCache.has(url)) {
        const promise = fetch(url).then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.arrayBuffer();
        }).catch(error => {
          bytesCache.delete(url);
          throw new Error('音源ファイルを読み込めません: ' + DEFINITIONS[key].file + ' (' + error.message + ')');
        });
        bytesCache.set(url, promise);
      }
      const cacheKey = url + ':' + context.sampleRate;
      if (!decodedCache.has(cacheKey)) {
        const promise = bytesCache.get(url).then(bytes => context.decodeAudioData(bytes.slice(0))).then(buffer => {
          if (key !== 'strings-a4') return buffer;
          // A short crossfade at the sustain-loop seam preserves the recorded
          // attack and avoids discontinuities when a compiler emits long notes.
          const result = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
          const fade = Math.round(buffer.sampleRate * 0.06);
          const end = Math.round(buffer.sampleRate * 1.25);
          const start = Math.round(buffer.sampleRate * 0.25);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = result.getChannelData(channel), original = buffer.getChannelData(channel);
            data.set(original);
            for (let i = 0; i < fade; i++) {
              const t = i / fade;
              data[end - fade + i] = original[end - fade + i] * (1 - t) + original[start + i] * t;
            }
          }
          return result;
        }).catch(error => { decodedCache.delete(cacheKey); throw error; });
        decodedCache.set(cacheKey, promise);
      }
      return [key, await decodedCache.get(cacheKey)];
    }));
    return Object.fromEntries(pairs);
  }

  function roomImpulse(context) {
    const length = Math.ceil(context.sampleRate * 0.95);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let seed = 104729 + channel * 7919, filtered = 0;
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        filtered = filtered * 0.68 + (((seed >>> 0) / 4294967296) * 2 - 1) * 0.32;
        const time = i / context.sampleRate;
        data[i] = time < 0.012 ? 0 : filtered * Math.exp(-time * 7.2) * 0.12;
      }
      [0.017, 0.031, 0.049, 0.073].forEach((time, index) => {
        data[Math.round((time + channel * 0.003) * context.sampleRate)] += 0.16 / (index + 1);
      });
    }
    return buffer;
  }

  function makeGraph(context, volume) {
    const input = context.createGain(); input.gain.value = 1.55;
    const dry = context.createGain(); dry.gain.value = 0.92;
    const room = context.createConvolver(); room.buffer = roomImpulse(context);
    const wet = context.createGain(); wet.gain.value = 0.13;
    const tone = context.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = Math.min(11500, context.sampleRate * 0.43); tone.Q.value = 0.4;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -15; compressor.knee.value = 14; compressor.ratio.value = 3.5;
    compressor.attack.value = 0.007; compressor.release.value = 0.17;
    const master = context.createGain(); master.gain.value = volume;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.09;
    const gate = context.createGain(); gate.gain.value = 0;
    input.connect(dry); dry.connect(tone); input.connect(room); room.connect(wet); wet.connect(tone);
    tone.connect(compressor); compressor.connect(master); master.connect(limiter); limiter.connect(gate); gate.connect(context.destination);
    return { input, master, gate, nodes: [input, dry, room, wet, tone, compressor, master, limiter, gate] };
  }

  function envelopeAt(time, duration, instrument) {
    const attack = Math.min(instrument === 'strings' ? 0.065 : 0.006, duration * 0.2);
    const release = Math.min(instrument === 'strings' ? 0.18 : 0.11, duration * 0.42);
    if (time < attack) return time / Math.max(0.00001, attack);
    if (time > duration - release) return Math.max(0, (duration - time) / Math.max(0.00001, release));
    return 1;
  }

  function scheduleEvent(context, graph, bank, event, origin, offset, total, tracked) {
    const elapsed = Math.max(0, offset - event.at);
    const clipped = Math.min(event.duration, total - event.at);
    if (!event.notes.length || elapsed >= clipped || clipped <= 0) return;
    const when = origin + Math.max(0, event.at - offset);
    const until = when + clipped - elapsed;
    const nodes = [], sources = [];
    const track = value => { nodes.push(value); return value; };
    const velocity = clamp(Number.isFinite(event.velocity) ? event.velocity : 0.8, 0, 1);
    const gainPerNote = velocity / Math.sqrt(Math.max(1, event.notes.length));
    function envelope(amount, instrument, midi) {
      const amp = track(context.createGain());
      const attack = Math.min(instrument === 'strings' ? 0.065 : 0.006, event.duration * 0.2);
      const release = Math.min(instrument === 'strings' ? 0.18 : 0.11, event.duration * 0.42);
      amp.gain.setValueAtTime(amount * envelopeAt(elapsed, event.duration, instrument), when);
      [attack, Math.max(attack, event.duration - release), event.duration].forEach(time => {
        if (time > elapsed) amp.gain.linearRampToValueAtTime(amount * envelopeAt(time, event.duration, instrument), when + time - elapsed);
      });
      // A function keeps one spectral colour even when another function uses
      // the same sampled instrument. Pitch and rhythm retain the quoted theme.
      let output = amp;
      if (Number.isFinite(event.voiceToneRatio) && Number.isFinite(midi)) {
        const voiceTone = track(context.createBiquadFilter());
        voiceTone.type = 'lowpass';
        voiceTone.frequency.value = Math.min(context.sampleRate * 0.43, hz(midi) * clamp(event.voiceToneRatio, 2, 16));
        voiceTone.Q.value = -3.0103;
        amp.connect(voiceTone); output = voiceTone;
      }
      if (Number.isFinite(event.pan)) {
        const panner = track(context.createStereoPanner()); panner.pan.value = clamp(event.pan, -1, 1);
        output.connect(panner); panner.connect(graph.input);
      } else output.connect(graph.input);
      return amp;
    }
    function sample(midi, key, amount, cents, pan) {
      const buffer = bank[key];
      const rate = Math.pow(2, (midi - DEFINITIONS[key].root) / 12) * Math.pow(2, cents / 1200);
      const source = track(context.createBufferSource()); source.buffer = buffer; source.playbackRate.value = rate;
      const amp = envelope(amount, event.instrument, midi);
      if (pan !== undefined) {
        const panner = track(context.createStereoPanner()); panner.pan.value = pan; source.connect(panner); panner.connect(amp);
      } else source.connect(amp);
      let position = elapsed * rate;
      if (event.instrument === 'strings') {
        source.loop = true; source.loopStart = 0.31; source.loopEnd = 1.25;
        if (position >= source.loopEnd) position = source.loopStart + (position - source.loopStart) % (source.loopEnd - source.loopStart);
      } else if (position >= buffer.duration) return;
      sources.push(source);
      source.start(when, position);
      source.stop(until);
    }
    function sine(midi, ratio, amount, decay, pitchDrop) {
      const oscillator = track(context.createOscillator()); oscillator.type = 'sine';
      const amp = track(context.createGain());
      const remaining = clipped - elapsed;
      const attack = Math.min(0.004, event.duration * 0.1);
      const releaseAt = Math.max(attack, event.duration - Math.min(0.045, event.duration * 0.2));
      const levelAt = time => {
        const attackGain = Math.min(1, time / Math.max(attack, 0.00001));
        const releaseGain = time > releaseAt ? Math.max(0, (event.duration - time) / Math.max(0.00001, event.duration - releaseAt)) : 1;
        return Math.max(0.00001, amount * Math.exp(-time * decay) * attackGain * releaseGain);
      };
      amp.gain.setValueAtTime(levelAt(elapsed), when);
      [attack, releaseAt, event.duration].forEach(time => {
        if (time > elapsed) amp.gain.exponentialRampToValueAtTime(levelAt(time), when + time - elapsed);
      });
      oscillator.frequency.setValueAtTime(hz(midi) * ratio * (pitchDrop ? 1 + 0.10 * Math.exp(-elapsed * 35) : 1), when);
      if (pitchDrop) oscillator.frequency.exponentialRampToValueAtTime(hz(midi) * ratio, when + Math.min(0.035, remaining * 0.4));
      oscillator.connect(amp); amp.connect(graph.input);
      sources.push(oscillator); oscillator.start(when); oscillator.stop(until);
    }
    event.notes.forEach(note => {
      const key = sampleKey(event.instrument, note);
      if (event.instrument === 'strings') {
        sample(note, key, gainPerNote * 0.30, -4, -0.30);
        sample(note, key, gainPerNote * 0.33, 0, 0);
        sample(note, key, gainPerNote * 0.30, 4, 0.30);
      } else if (event.instrument === 'percussion') {
        sine(note, 1, gainPerNote * 0.36, 12, true);
        sine(note, 2.756, gainPerNote * 0.10, 24, false);
        sine(note, 5.404, gainPerNote * 0.04, 35, false);
      } else {
        sample(note, key, gainPerNote * (event.instrument === 'pluck' ? 0.73 : 0.77), 0);
        if (event.instrument === 'bass') sine(note, 1, gainPerNote * 0.18, 1.3, false);
      }
    });
    if (!sources.length) { nodes.forEach(node => node.disconnect()); return; }
    const item = { nodes, sources }; tracked.add(item);
    let remaining = sources.length;
    sources.forEach(source => {
      source.onended = () => {
        remaining--;
        if (!remaining) { nodes.forEach(node => { try { node.disconnect(); } catch (_) {} }); tracked.delete(item); }
      };
    });
  }

  class ScorePlayer {
    constructor(options) {
      this.options = Object.assign({ sampleBaseUrl: './audio-assets/' }, options);
      this.context = null; this.graph = null; this.nodes = new Set();
      this.volume = 0.35; this.generation = 0; this.frame = null; this.duration = 0; this.position = 0;
    }

    setVolume(value) {
      if (!Number.isFinite(value)) return;
      this.volume = clamp(value, 0, 1);
      if (this.graph && this.context.state !== 'closed') {
        this.graph.master.gain.cancelScheduledValues(this.context.currentTime);
        this.graph.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.025);
      }
    }

    stop() {
      this.generation++;
      if (this.frame !== null) { global.cancelAnimationFrame(this.frame); this.frame = null; }
      if (this.graph) {
        this.graph.gate.gain.cancelScheduledValues(this.context.currentTime);
        this.graph.gate.gain.setValueAtTime(0, this.context.currentTime);
      }
      this.nodes.forEach(item => {
        item.sources.forEach(source => { try { source.stop(); } catch (_) {} });
        item.nodes.forEach(node => { try { node.disconnect(); } catch (_) {} });
      });
      this.nodes.clear();
      // Recreate the room on each playback; no reverb from a previous audition
      // can leak into the next deterministic comparison.
      if (this.graph) this.graph.nodes.forEach(node => { try { node.disconnect(); } catch (_) {} });
      this.graph = null;
    }

    async play(timeline, options) {
      options = options || {};
      const events = normalize(timeline), duration = totalDuration(events, options.duration);
      this.stop();
      const generation = this.generation;
      this.setVolume(options.volume === undefined ? this.volume : options.volume);
      if (!this.context || this.context.state === 'closed') {
        const AudioContext = global.AudioContext || global.webkitAudioContext;
        if (!AudioContext) throw new Error('このブラウザは Web Audio に対応していません。');
        this.context = new AudioContext({ latencyHint: 'interactive' });
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (generation !== this.generation) return;
      if (this.context.state !== 'running') throw new Error('音声を開始できません。再生ボタンをクリックしてください。');
      const effective = Object.assign({}, this.options, options);
      const audibleEvents = events.filter(event => event.at < duration && event.at + event.duration > (options.startSec || 0));
      const bank = await loadSamples(this.context, audibleEvents, effective);
      if (generation !== this.generation) return;
      this.duration = duration;
      const offset = clamp(Number.isFinite(options.startSec) ? options.startSec : 0, 0, duration);
      this.position = offset;
      this.graph = makeGraph(this.context, this.volume);
      const origin = this.context.currentTime + 0.10;
      this.graph.gate.gain.setValueAtTime(1, origin);
      this.graph.gate.gain.setValueAtTime(0, origin + duration - offset);
      try {
        audibleEvents.forEach(event => scheduleEvent(this.context, this.graph, bank, event, origin, offset, duration, this.nodes));
      } catch (error) { this.stop(); throw error; }
      const tick = () => {
        if (generation !== this.generation) return;
        const timestamp = this.context.getOutputTimestamp ? this.context.getOutputTimestamp() : null;
        const clock = timestamp && timestamp.contextTime > 0 ? timestamp.contextTime : this.context.currentTime;
        const seconds = clamp(offset + clock - origin, offset, duration);
        this.position = seconds;
        const active = events.filter(event => event.at <= seconds && seconds < event.at + event.duration);
        if (options.onTick) options.onTick(seconds, active[active.length - 1], active);
        if (generation !== this.generation) return;
        if (seconds >= duration) { this.stop(); if (options.onEnd) options.onEnd(); }
        else this.frame = global.requestAnimationFrame(tick);
      };
      tick();
    }

    static async renderOffline(timeline, options) {
      options = options || {};
      const events = normalize(timeline), duration = totalDuration(events, options.duration);
      const OfflineContext = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!OfflineContext) throw new Error('オフライン音声書き出しに対応していません。');
      const sampleRate = clamp(options.sampleRate || 44100, 8000, 96000);
      const context = new OfflineContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
      const bank = await loadSamples(context, events.filter(event => event.at < duration), options);
      const graph = makeGraph(context, clamp(Number.isFinite(options.volume) ? options.volume : 0.35, 0, 1));
      const tracked = new Set();
      graph.gate.gain.setValueAtTime(1, 0); graph.gate.gain.setValueAtTime(0, duration);
      events.forEach(event => scheduleEvent(context, graph, bank, event, 0, 0, duration, tracked));
      const buffer = await context.startRendering();
      graph.nodes.forEach(node => node.disconnect());
      return buffer;
    }
  }
  ScorePlayer.instruments = INSTRUMENTS.slice();
  ScorePlayer.sampleFiles = Object.fromEntries(Object.entries(DEFINITIONS).map(([key, value]) => [key, value.file]));
  ScorePlayer.durationOf = timeline => totalDuration(normalize(timeline));
  ScorePlayer.attribution = { source: 'University of Iowa Electronic Music Studios', url: 'https://theremin.music.uiowa.edu/MIS.html', licenseFile: 'audio-assets/LICENSE.txt' };
  global.ScorePlayer = ScorePlayer;
})(window);
