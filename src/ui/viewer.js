/* CraftRank Launcher: a small WebGL player viewer (skin, cape, cosmetics), turned by dragging. */
(() => {
  const VS = 'attribute vec3 p;attribute vec2 t;attribute float s;uniform mat4 m;varying vec2 v;varying float l;void main(){v=t;l=s;gl_Position=m*vec4(p,1.);}';
  const FS = 'precision mediump float;uniform sampler2D x;varying vec2 v;varying float l;void main(){vec4 c=texture2D(x,v);if(c.a<.5)discard;gl_FragColor=vec4(c.rgb*l,1.);}';
  const mul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
  const persp = (f, a, n, z) => { const t = 1 / Math.tan(f / 2); return new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (z + n) / (n - z), -1, 0, 0, 2 * z * n / (n - z), 0]); };
  const tr = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  const app = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

  // one box in Minecraft's texture layout; tw/th is the texture size in the same pixels as u/v
  function box(out, u, v, w, h, d, inf, M, tw, th) {
    const x = w / 2 + inf, y = h / 2 + inf, z = d / 2 + inf;
    const q = (a, b, c, e, uu, vv, uw, vh, sh) => {   // a b c e: top-left, top-right, bottom-right, bottom-left
      const P = [a, b, c, e].map((pt) => app(M, pt)), T = [[uu, vv], [uu + uw, vv], [uu + uw, vv + vh], [uu, vv + vh]];
      [0, 1, 2, 0, 2, 3].forEach((i) => out.push(P[i][0], P[i][1], P[i][2], T[i][0] / tw, T[i][1] / th, sh));
    };
    q([-x, y, z], [x, y, z], [x, -y, z], [-x, -y, z], u + d, v + d, w, h, 1);            // front
    q([x, y, -z], [-x, y, -z], [-x, -y, -z], [x, -y, -z], u + 2 * d + w, v + d, w, h, .62); // back
    q([-x, y, -z], [-x, y, z], [-x, -y, z], [-x, -y, -z], u, v + d, d, h, .8);            // right (character's)
    q([x, y, z], [x, y, -z], [x, -y, -z], [x, -y, z], u + d + w, v + d, d, h, .8);        // left
    q([-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], u + d, v, w, d, 1.08);             // top
    q([-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z], u + d + w, v, w, d, .5);       // bottom
  }

  function player(slim) {
    const inner = [], outer = [], a = slim ? 3 : 4, T = 64;
    const part = (u, v, u2, v2, w, h, d, X, Y, Z, inf) => { const M = tr(X, Y, Z); box(inner, u, v, w, h, d, 0, M, T, T); box(outer, u2, v2, w, h, d, inf, M, T, T); };
    part(0, 0, 32, 0, 8, 8, 8, 0, 28, 0, .5);
    part(16, 16, 16, 32, 8, 12, 4, 0, 18, 0, .25);
    part(40, 16, 40, 32, a, 12, 4, -4 - a / 2, 18, 0, .25);
    part(32, 48, 48, 48, a, 12, 4, 4 + a / 2, 18, 0, .25);
    part(0, 16, 0, 32, 4, 12, 4, -2, 6, 0, .25);
    part(16, 48, 0, 48, 4, 12, 4, 2, 6, 0, .25);
    return inner.concat(outer);
  }
  function cape() {   // 10×16×1 on a 64×32 grid, outer side to the back, hanging from the shoulders
    const out = [], M = mul(tr(0, 24, -2.6), mul(rx(0.14), mul(ry(Math.PI), tr(0, -8, 0))));
    box(out, 0, 0, 10, 16, 1, 0, M, 64, 32);
    return out;
  }

  // 64×32 skins (before 1.8) to 64×64: the left arm and leg copy the right ones
  function skin64(img) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    if (!img) { x.fillStyle = '#3a3d42'; x.fillRect(0, 0, 64, 64); return c; }
    x.drawImage(img, 0, 0);
    if (img.height === 32) { x.drawImage(img, 0, 16, 16, 16, 16, 48, 16, 16); x.drawImage(img, 40, 16, 16, 16, 32, 48, 16, 16); }
    return c;
  }

  class View {
    constructor(cv) {
      this.cv = cv; this.yaw = -0.5; this.goal = null; this.slim = false; this.capeTex = null; this.anim = null;
      const gl = this.gl = cv.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
      if (!gl) return;
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
      const pg = this.pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pg); gl.useProgram(pg);
      this.loc = { p: gl.getAttribLocation(pg, 'p'), t: gl.getAttribLocation(pg, 't'), s: gl.getAttribLocation(pg, 's'), m: gl.getUniformLocation(pg, 'm') };
      this.pb = gl.createBuffer(); this.cb = gl.createBuffer();
      this.skinTex = this.tex(skin64(null));
      this.setModel(false);
      const cb = cape(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cb), gl.STATIC_DRAW); this.cn = cb.length / 6;
      gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
      let drag = null;
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: this.yaw }; this.goal = null; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
      cv.addEventListener('pointermove', (e) => { if (!drag) return; this.yaw = drag.y + (e.clientX - drag.x) * 0.012; this.draw(); });
      const end = () => { drag = null; cv.classList.remove('drag'); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    }
    tex(src, old) {
      const gl = this.gl, t = old || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    setModel(slim) { const gl = this.gl, b = player(slim); this.slim = slim; gl.bindBuffer(gl.ARRAY_BUFFER, this.pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b), gl.STATIC_DRAW); this.pn = b.length / 6; }
    /** skin: Image or null; overlays: Images drawn on top (cosmetics); slim arms */
    setSkin(img, overlays, slim) {
      if (!this.gl) return;
      const c = skin64(img), x = c.getContext('2d');
      (overlays || []).forEach((o) => o && x.drawImage(o, 0, 0, 64, 64));
      this.tex(c, this.skinTex);
      if (!!slim !== this.slim) this.setModel(!!slim);
      this.draw();
    }
    /** cape: Image (any size, 64×32 layout) or null; anim: { img, fps } strip of frames under each other */
    setCape(img, anim) {
      if (!this.gl) return;
      this.capeImg = img; this.anim = null;
      if (!img) { this.capeTex = null; this.draw(); return; }
      if (anim && anim.img) {
        const k = img.width / 64, n = Math.max(1, Math.floor(anim.img.height / (32 * k)));
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        this.anim = { img: anim.img, fps: anim.fps || 12, n, c, x: c.getContext('2d'), last: -1, k };
      }
      this.capeTex = this.tex(img, this.capeTex || undefined);
      this.draw();
    }
    face(back) { this.goal = back ? Math.PI - 0.5 : -0.5; }
    loop(ts) {
      if (!this.cv.isConnected) return;
      requestAnimationFrame(this.loop);
      if (!this.cv.offsetParent) return;      // not on screen
      let dirty = false;
      if (this.goal !== null) { const d = this.goal - this.yaw; if (Math.abs(d) < 0.002) { this.yaw = this.goal; this.goal = null; } else this.yaw += d * 0.18; dirty = true; }
      const a = this.anim;
      if (a && this.capeTex) {
        const f = Math.floor(ts / 1000 * a.fps) % a.n;
        if (f !== a.last) { a.last = f; a.x.clearRect(0, 0, a.c.width, a.c.height); a.x.drawImage(a.img, 0, f * 32 * a.k, a.c.width, 32 * a.k, 0, 0, a.c.width, 32 * a.k); this.tex(a.c, this.capeTex); dirty = true; }
      }
      if (dirty || this.cv.width !== Math.round(this.cv.clientWidth * devicePixelRatio)) this.draw();
    }
    draw() {
      const gl = this.gl; if (!gl) return;
      const w = Math.round(this.cv.clientWidth * devicePixelRatio), h = Math.round(this.cv.clientHeight * devicePixelRatio);
      if (!w || !h) return;
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
      gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const m = mul(persp(0.5, w / h, 1, 300), mul(tr(0, 1.2, -90), mul(rx(0.1), mul(ry(this.yaw), tr(0, -16, 0)))));
      gl.uniformMatrix4fv(this.loc.m, false, m);
      const run = (buf, n, t) => {
        gl.bindTexture(gl.TEXTURE_2D, t); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(this.loc.p); gl.vertexAttribPointer(this.loc.p, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(this.loc.t); gl.vertexAttribPointer(this.loc.t, 2, gl.FLOAT, false, 24, 12);
        gl.enableVertexAttribArray(this.loc.s); gl.vertexAttribPointer(this.loc.s, 1, gl.FLOAT, false, 24, 20);
        gl.drawArrays(gl.TRIANGLES, 0, n);
      };
      run(this.pb, this.pn, this.skinTex);
      if (this.capeTex) run(this.cb, this.cn, this.capeTex);
    }
  }
  window.PlayerView = View;
})();
