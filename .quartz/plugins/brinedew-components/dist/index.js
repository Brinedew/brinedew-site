// ../../../node_modules/.pnpm/github-slugger@2.0.0/node_modules/github-slugger/index.js
var own = Object.hasOwnProperty;

// ../../../node_modules/.pnpm/preact@10.29.8_preact-render-to-string@6.7.0/node_modules/preact/dist/preact.mjs
var n;
var l;
var u;
var t;
var i;
var r;
var o;
var e;
var f;
var c;
var a;
var s;
var h;
var p;
var v;
var y;
var d = {};
var w = [];
var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var g = Array.isArray;
function m(n2, l2) {
  for (var u3 in l2) n2[u3] = l2[u3];
  return n2;
}
function b(n2) {
  n2 && n2.parentNode && n2.parentNode.removeChild(n2);
}
function x(n2, t2, i2, r2, o2) {
  var e2 = { type: n2, props: t2, key: i2, ref: r2, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o2 ? ++u : o2, __i: -1, __u: 0 };
  return null == o2 && null != l.vnode && l.vnode(e2), e2;
}
function S(n2) {
  return n2.children;
}
function C(n2, l2) {
  this.props = n2, this.context = l2;
}
function $(n2, l2) {
  if (null == l2) return n2.__ ? $(n2.__, n2.__i + 1) : null;
  for (var u3; l2 < n2.__k.length; l2++) if (null != (u3 = n2.__k[l2]) && null != u3.__e) return u3.__e;
  return "function" == typeof n2.type ? $(n2) : null;
}
function I(n2) {
  if (n2.__P && n2.__d) {
    var u3 = n2.__v, t2 = u3.__e, i2 = [], r2 = [], o2 = m({}, u3);
    o2.__v = u3.__v + 1, l.vnode && l.vnode(o2), q(n2.__P, o2, u3, n2.__n, n2.__P.namespaceURI, 32 & u3.__u ? [t2] : null, i2, null == t2 ? $(u3) : t2, !!(32 & u3.__u), r2), o2.__v = u3.__v, o2.__.__k[o2.__i] = o2, D(i2, o2, r2), u3.__e = u3.__ = null, o2.__e != t2 && P(o2);
  }
}
function P(n2) {
  if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l2) {
    if (null != l2 && null != l2.__e) return n2.__e = n2.__c.base = l2.__e;
  }), P(n2);
}
function A(n2) {
  (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
}
function H() {
  try {
    for (var n2, l2 = 1; i.length; ) i.length > l2 && i.sort(e), n2 = i.shift(), l2 = i.length, I(n2);
  } finally {
    i.length = H.__r = 0;
  }
}
function L(n2, l2, u3, t2, i2, r2, o2, e2, f3, c2, a2) {
  var s2, h2, p2, v2, y2, _2, g2 = t2 && t2.__k || w, m2 = l2.length;
  for (f3 = T(u3, l2, g2, f3, m2), s2 = 0; s2 < m2; s2++) null != (p2 = u3.__k[s2]) && (h2 = -1 != p2.__i && g2[p2.__i] || d, p2.__i = s2, _2 = q(n2, p2, h2, i2, r2, o2, e2, f3, c2, a2), v2 = p2.__e, p2.ref && h2.ref != p2.ref && (h2.ref && J(h2.ref, null, p2), a2.push(p2.ref, p2.__c || v2, p2)), null == y2 && null != v2 && (y2 = v2), 4 & p2.__u ? (f3 = j(p2, f3, n2), h2.__e && (h2.__e = null)) : "function" == typeof p2.type && void 0 !== _2 ? f3 = _2 : v2 && (f3 = v2.nextSibling), p2.__u &= -7);
  return u3.__e = y2, f3;
}
function T(n2, l2, u3, t2, i2) {
  var r2, o2, e2, f3, c2, a2 = u3.length, s2 = a2, h2 = 0;
  for (n2.__k = new Array(i2), r2 = 0; r2 < i2; r2++) null != (o2 = l2[r2]) && "boolean" != typeof o2 && "function" != typeof o2 ? ("string" == typeof o2 || "number" == typeof o2 || "bigint" == typeof o2 || o2.constructor == String ? o2 = n2.__k[r2] = x(null, o2, null, null, null) : g(o2) ? o2 = n2.__k[r2] = x(S, { children: o2 }, null, null, null) : void 0 === o2.constructor && o2.__b > 0 ? o2 = n2.__k[r2] = x(o2.type, o2.props, o2.key, o2.ref ? o2.ref : null, o2.__v) : n2.__k[r2] = o2, f3 = r2 + h2, o2.__ = n2, o2.__b = n2.__b + 1, e2 = null, -1 != (c2 = o2.__i = O(o2, u3, f3, s2)) && (s2--, (e2 = u3[c2]) && (e2.__u |= 2)), null == e2 || null == e2.__v ? (-1 == c2 && (i2 > a2 ? h2-- : i2 < a2 && h2++), "function" != typeof o2.type && (o2.__u |= 4)) : c2 != f3 && (c2 == f3 - 1 ? h2-- : c2 == f3 + 1 ? h2++ : (c2 > f3 ? h2-- : h2++, o2.__u |= 4))) : n2.__k[r2] = null;
  if (s2) for (r2 = 0; r2 < a2; r2++) null != (e2 = u3[r2]) && 0 == (2 & e2.__u) && (e2.__e == t2 && (t2 = $(e2)), K(e2, e2));
  return t2;
}
function j(n2, l2, u3) {
  var t2, i2;
  if ("function" == typeof n2.type) {
    for (t2 = n2.__k, i2 = 0; t2 && i2 < t2.length; i2++) t2[i2] && (t2[i2].__ = n2, l2 = j(t2[i2], l2, u3));
    return l2;
  }
  n2.__e != l2 && (l2 && n2.type && !l2.parentNode && (l2 = $(n2)), l2 = u3.insertBefore(n2.__e, l2 || null));
  do {
    l2 = l2 && l2.nextSibling;
  } while (null != l2 && 8 == l2.nodeType);
  return l2;
}
function O(n2, l2, u3, t2) {
  var i2, r2, o2, e2 = n2.key, f3 = n2.type, c2 = l2[u3], a2 = null != c2 && 0 == (2 & c2.__u);
  if (null === c2 && null == e2 || a2 && e2 == c2.key && f3 == c2.type) return u3;
  if (t2 > (a2 ? 1 : 0)) {
    for (i2 = u3 - 1, r2 = u3 + 1; i2 >= 0 || r2 < l2.length; ) if (null != (c2 = l2[o2 = i2 >= 0 ? i2-- : r2++]) && 0 == (2 & c2.__u) && e2 == c2.key && f3 == c2.type) return o2;
  }
  return -1;
}
function z(n2, l2, u3) {
  "-" == l2[0] ? n2.setProperty(l2, null == u3 ? "" : u3) : n2[l2] = null == u3 ? "" : "number" != typeof u3 || _.test(l2) ? u3 : u3 + "px";
}
function N(n2, l2, u3, t2, i2) {
  var r2, o2;
  n: if ("style" == l2) if ("string" == typeof u3) n2.style.cssText = u3;
  else {
    if ("string" == typeof t2 && (n2.style.cssText = t2 = ""), t2) for (l2 in t2) u3 && l2 in u3 || z(n2.style, l2, "");
    if (u3) for (l2 in u3) t2 && u3[l2] == t2[l2] || z(n2.style, l2, u3[l2]);
  }
  else if ("o" == l2[0] && "n" == l2[1]) r2 = l2 != (l2 = l2.replace(s, "$1")), o2 = l2.toLowerCase(), l2 = o2 in n2 || "onFocusOut" == l2 || "onFocusIn" == l2 ? o2.slice(2) : l2.slice(2), n2.l || (n2.l = {}), n2.l[l2 + r2] = u3, u3 ? t2 ? u3[a] = t2[a] : (u3[a] = h, n2.addEventListener(l2, r2 ? v : p, r2)) : n2.removeEventListener(l2, r2 ? v : p, r2);
  else {
    if ("http://www.w3.org/2000/svg" == i2) l2 = l2.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if ("width" != l2 && "height" != l2 && "href" != l2 && "list" != l2 && "form" != l2 && "tabIndex" != l2 && "download" != l2 && "rowSpan" != l2 && "colSpan" != l2 && "role" != l2 && "popover" != l2 && l2 in n2) try {
      n2[l2] = null == u3 ? "" : u3;
      break n;
    } catch (n3) {
    }
    "function" == typeof u3 || (null == u3 || false === u3 && "-" != l2[4] ? n2.removeAttribute(l2) : n2.setAttribute(l2, "popover" == l2 && 1 == u3 ? "" : u3));
  }
}
function V(n2) {
  return function(u3) {
    if (this.l) {
      var t2 = this.l[u3.type + n2];
      if (null == u3[c]) u3[c] = h++;
      else if (u3[c] < t2[a]) return;
      return t2(l.event ? l.event(u3) : u3);
    }
  };
}
function q(n2, u3, t2, i2, r2, o2, e2, f3, c2, a2) {
  var s2, h2, p2, v2, y2, d2, _2, k2, x2, M, I2, P2, A2, H2, T2, j2, F = u3.type;
  if (void 0 !== u3.constructor) return null;
  128 & t2.__u && (c2 = !!(32 & t2.__u), o2 = [f3 = u3.__e = t2.__e]), (s2 = l.__b) && s2(u3);
  n: if ("function" == typeof F) {
    h2 = e2.length;
    try {
      if (x2 = u3.props, M = F.prototype && F.prototype.render, I2 = (s2 = F.contextType) && i2[s2.__c], P2 = s2 ? I2 ? I2.props.value : s2.__ : i2, t2.__c ? k2 = (p2 = u3.__c = t2.__c).__ = p2.__E : (M ? u3.__c = p2 = new F(x2, P2) : (u3.__c = p2 = new C(x2, P2), p2.constructor = F, p2.render = Q), I2 && I2.sub(p2), p2.state || (p2.state = {}), p2.__n = i2, v2 = p2.__d = true, p2.__h = [], p2._sb = []), M && null == p2.__s && (p2.__s = p2.state), M && null != F.getDerivedStateFromProps && (p2.__s == p2.state && (p2.__s = m({}, p2.__s)), m(p2.__s, F.getDerivedStateFromProps(x2, p2.__s))), y2 = p2.props, d2 = p2.state, p2.__v = u3, v2) M && null == F.getDerivedStateFromProps && null != p2.componentWillMount && p2.componentWillMount(), M && null != p2.componentDidMount && p2.__h.push(p2.componentDidMount);
      else {
        if (M && null == F.getDerivedStateFromProps && x2 !== y2 && null != p2.componentWillReceiveProps && p2.componentWillReceiveProps(x2, P2), u3.__v == t2.__v || !p2.__e && null != p2.shouldComponentUpdate && false === p2.shouldComponentUpdate(x2, p2.__s, P2)) {
          u3.__v != t2.__v && (p2.props = x2, p2.state = p2.__s, p2.__d = false), u3.__e = t2.__e, u3.__k = t2.__k, u3.__k.some(function(n3) {
            n3 && (n3.__ = u3);
          }), w.push.apply(p2.__h, p2._sb), p2._sb = [], p2.__h.length && e2.push(p2), f3 = $(t2);
          break n;
        }
        null != p2.componentWillUpdate && p2.componentWillUpdate(x2, p2.__s, P2), M && null != p2.componentDidUpdate && p2.__h.push(function() {
          p2.componentDidUpdate(y2, d2, _2);
        });
      }
      if (p2.context = P2, p2.props = x2, p2.__P = n2, p2.__e = false, A2 = l.__r, H2 = 0, M) p2.state = p2.__s, p2.__d = false, A2 && A2(u3), s2 = p2.render(p2.props, p2.state, p2.context), w.push.apply(p2.__h, p2._sb), p2._sb = [];
      else do {
        p2.__d = false, A2 && A2(u3), s2 = p2.render(p2.props, p2.state, p2.context), p2.state = p2.__s;
      } while (p2.__d && ++H2 < 25);
      p2.state = p2.__s, null != p2.getChildContext && (i2 = m(m({}, i2), p2.getChildContext())), M && !v2 && null != p2.getSnapshotBeforeUpdate && (_2 = p2.getSnapshotBeforeUpdate(y2, d2)), T2 = null != s2 && s2.type === S && null == s2.key ? E(s2.props.children) : s2, f3 = L(n2, g(T2) ? T2 : [T2], u3, t2, i2, r2, o2, e2, f3, c2, a2), p2.base = u3.__e, u3.__u &= -161, p2.__h.length && e2.push(p2), k2 && (p2.__E = p2.__ = null);
    } catch (n3) {
      if (e2.length = h2, u3.__v = null, c2 || null != o2) {
        if (n3.then) {
          for (u3.__u |= c2 ? 160 : 128; f3 && 8 == f3.nodeType && f3.nextSibling; ) f3 = f3.nextSibling;
          null != o2 && (o2[o2.indexOf(f3)] = null), u3.__e = f3;
        } else if (null != o2) for (j2 = o2.length; j2--; ) b(o2[j2]);
      } else u3.__e = t2.__e;
      null == u3.__k && (u3.__k = t2.__k || []), n3.then || B(u3), l.__e(n3, u3, t2);
    }
  } else null == o2 && u3.__v == t2.__v ? (u3.__k = t2.__k, u3.__e = t2.__e) : f3 = u3.__e = G(t2.__e, u3, t2, i2, r2, o2, e2, c2, a2);
  return (s2 = l.diffed) && s2(u3), 128 & u3.__u ? void 0 : f3;
}
function B(n2) {
  n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
}
function D(n2, u3, t2) {
  for (var i2 = 0; i2 < t2.length; i2++) J(t2[i2], t2[++i2], t2[++i2]);
  l.__c && l.__c(u3, n2), n2.some(function(u4) {
    try {
      n2 = u4.__h, u4.__h = [], n2.some(function(n3) {
        n3.call(u4);
      });
    } catch (n3) {
      l.__e(n3, u4.__v);
    }
  });
}
function E(n2) {
  return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : void 0 !== n2.constructor ? null : m({}, n2);
}
function G(u3, t2, i2, r2, o2, e2, f3, c2, a2) {
  var s2, h2, p2, v2, y2, w2, _2, m2 = i2.props || d, k2 = t2.props, x2 = t2.type;
  if ("svg" == x2 ? o2 = "http://www.w3.org/2000/svg" : "math" == x2 ? o2 = "http://www.w3.org/1998/Math/MathML" : o2 || (o2 = "http://www.w3.org/1999/xhtml"), null != e2) {
    for (s2 = 0; s2 < e2.length; s2++) if ((y2 = e2[s2]) && "setAttribute" in y2 == !!x2 && (x2 ? y2.localName == x2 : 3 == y2.nodeType)) {
      u3 = y2, e2[s2] = null;
      break;
    }
  }
  if (null == u3) {
    if (null == x2) return document.createTextNode(k2);
    u3 = document.createElementNS(o2, x2, k2.is && k2), c2 && (l.__m && l.__m(t2, e2), c2 = false), e2 = null;
  }
  if (null == x2) m2 === k2 || c2 && u3.data == k2 || (u3.data = k2);
  else {
    if (e2 = "textarea" == x2 && null != k2.defaultValue ? null : e2 && n.call(u3.childNodes), !c2 && null != e2) for (m2 = {}, s2 = 0; s2 < u3.attributes.length; s2++) m2[(y2 = u3.attributes[s2]).name] = y2.value;
    for (s2 in m2) y2 = m2[s2], "dangerouslySetInnerHTML" == s2 ? p2 = y2 : "children" == s2 || s2 in k2 || "value" == s2 && "defaultValue" in k2 || "checked" == s2 && "defaultChecked" in k2 || N(u3, s2, null, y2, o2);
    for (s2 in k2) y2 = k2[s2], "children" == s2 ? v2 = y2 : "dangerouslySetInnerHTML" == s2 ? h2 = y2 : "value" == s2 ? w2 = y2 : "checked" == s2 ? _2 = y2 : c2 && "function" != typeof y2 || m2[s2] === y2 || N(u3, s2, y2, m2[s2], o2);
    if (h2) c2 || p2 && (h2.__html == p2.__html || h2.__html == u3.innerHTML) || (u3.innerHTML = h2.__html), t2.__k = [];
    else if (p2 && (u3.innerHTML = ""), L("template" == t2.type ? u3.content : u3, g(v2) ? v2 : [v2], t2, i2, r2, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o2, e2, f3, e2 ? e2[0] : i2.__k && $(i2, 0), c2, a2), null != e2) for (s2 = e2.length; s2--; ) b(e2[s2]);
    c2 && "textarea" != x2 || (s2 = "value", "progress" == x2 && null == w2 ? u3.removeAttribute("value") : null != w2 && (w2 !== u3[s2] || "progress" == x2 && !w2 || "option" == x2 && w2 != m2[s2]) && N(u3, s2, w2, m2[s2], o2), s2 = "checked", null != _2 && _2 != u3[s2] && N(u3, s2, _2, m2[s2], o2));
  }
  return u3;
}
function J(n2, u3, t2) {
  try {
    if ("function" == typeof n2) {
      var i2 = "function" == typeof n2.__u;
      i2 && n2.__u(), i2 && null == u3 || (n2.__u = n2(u3));
    } else n2.current = u3;
  } catch (n3) {
    l.__e(n3, t2);
  }
}
function K(n2, u3, t2) {
  var i2, r2;
  if (l.unmount && l.unmount(n2), (i2 = n2.ref) && (i2.current && i2.current != n2.__e || J(i2, null, u3)), null != (i2 = n2.__c)) {
    if (i2.componentWillUnmount) try {
      i2.componentWillUnmount();
    } catch (n3) {
      l.__e(n3, u3);
    }
    i2.base = i2.__P = i2.__n = null;
  }
  if (i2 = n2.__k) for (r2 = 0; r2 < i2.length; r2++) i2[r2] && K(i2[r2], u3, t2 || "function" != typeof n2.type);
  t2 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
}
function Q(n2, l2, u3) {
  return this.constructor(n2, u3);
}
n = w.slice, l = { __e: function(n2, l2, u3, t2) {
  for (var i2, r2, o2; l2 = l2.__; ) if ((i2 = l2.__c) && !i2.__) try {
    if ((r2 = i2.constructor) && null != r2.getDerivedStateFromError && (i2.setState(r2.getDerivedStateFromError(n2)), o2 = i2.__d), null != i2.componentDidCatch && (i2.componentDidCatch(n2, t2 || {}), o2 = i2.__d), o2) return i2.__E = i2;
  } catch (l3) {
    n2 = l3;
  }
  throw n2;
} }, u = 0, t = function(n2) {
  return null != n2 && void 0 === n2.constructor;
}, C.prototype.setState = function(n2, l2) {
  var u3;
  u3 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u3), this.props)), n2 && m(u3, n2), null != n2 && this.__v && (l2 && this._sb.push(l2), A(this));
}, C.prototype.forceUpdate = function(n2) {
  this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
}, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l2) {
  return n2.__v.__b - l2.__v.__b;
}, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;

// ../../../node_modules/.pnpm/preact@10.29.8_preact-render-to-string@6.7.0/node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs
var f2 = 0;
function u2(e2, t2, n2, o2, i2, u3) {
  t2 || (t2 = {});
  var a2, c2, p2 = t2;
  if ("ref" in p2) for (c2 in p2 = {}, t2) "ref" == c2 ? a2 = t2[c2] : p2[c2] = t2[c2];
  var l2 = { type: e2, props: p2, key: n2, ref: a2, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f2, __i: -1, __u: 0, __source: i2, __self: u3 };
  if ("function" == typeof e2 && (a2 = e2.defaultProps)) for (c2 in a2) void 0 === p2[c2] && (p2[c2] = a2[c2]);
  return l.vnode && l.vnode(l2), l2;
}

// ../../../node_modules/.pnpm/@quartz-community+utils@0.1_236326e92195e1478e36b265a65fb1bd/node_modules/@quartz-community/utils/dist/index.js
function simplifySlug(fp) {
  const res = stripSlashes(trimSuffix(fp, "index"), true);
  return res.length === 0 ? "/" : res;
}
function joinSegments(...args) {
  if (args.length === 0) {
    return "";
  }
  let joined = args.filter((segment) => segment !== "" && segment !== "/").map((segment) => stripSlashes(segment)).join("/");
  const first = args[0];
  const last = args[args.length - 1];
  if (first?.startsWith("/")) {
    joined = "/" + joined;
  }
  if (last?.endsWith("/")) {
    joined = joined + "/";
  }
  return joined;
}
function endsWith(s2, suffix) {
  return s2 === suffix || s2.endsWith("/" + suffix);
}
function trimSuffix(s2, suffix) {
  if (endsWith(s2, suffix)) {
    s2 = s2.slice(0, -suffix.length);
  }
  return s2;
}
function stripSlashes(s2, onlyStripPrefix) {
  if (s2.startsWith("/")) {
    s2 = s2.substring(1);
  }
  if (!onlyStripPrefix && s2.endsWith("/")) {
    s2 = s2.slice(0, -1);
  }
  return s2;
}
function isFolderPath(fplike) {
  return fplike.endsWith("/") || endsWith(fplike, "index") || endsWith(fplike, "index.md") || endsWith(fplike, "index.html");
}
function pathToRoot(slug2) {
  let rootPath = slug2.split("/").filter((x2) => x2 !== "").slice(0, -1).map((_2) => "..").join("/");
  if (rootPath.length === 0) {
    rootPath = ".";
  }
  return rootPath;
}
function resolveRelative(current, target) {
  const res = joinSegments(pathToRoot(current), simplifySlug(target));
  return res;
}
function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}
var U200D = String.fromCharCode(8205);

// src/util/crawlability.ts
var truthyFrontmatter = (value) => value === true || value === "true";
var subdomainMappings = {
  "apps/geneguessr": "geneguessr.brinedew.bio",
  "apps/iconoplasm": "iconoplasm.brinedew.bio"
};
function isNoIndexFile(file) {
  const fm = file.frontmatter ?? {};
  return truthyFrontmatter(fm.noindex) || truthyFrontmatter(fm.excludeFromSearch);
}
function isCrawlableFile(file) {
  if (typeof file.slug !== "string" || file.slug.length === 0 || isNoIndexFile(file)) {
    return false;
  }
  if (file.slug.startsWith("Attachments/") || file.slug.includes(".excalidraw")) {
    return false;
  }
  if (typeof file.text === "string" && file.text.trim().length === 0) {
    return false;
  }
  return true;
}
function getPublicUrlForSlug(baseUrl, slug2) {
  const simpleSlug = simplifySlug(slug2);
  if (simpleSlug === "/" || simpleSlug === "index") {
    return `https://${baseUrl}/`;
  }
  for (const [pathPrefix, subdomain] of Object.entries(subdomainMappings)) {
    if (simpleSlug === pathPrefix || simpleSlug.startsWith(pathPrefix + "/")) {
      if (simpleSlug === pathPrefix) {
        return `https://${subdomain}/`;
      }
      return `https://${subdomain}${simpleSlug.slice(pathPrefix.length)}`;
    }
  }
  return `https://${joinSegments(baseUrl, encodeURI(simpleSlug))}`;
}
function classifyCrawlSection(file) {
  const slug2 = String(file.slug ?? "");
  const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter.tags : [];
  const isDraft = file.frontmatter?.draft === true || file.frontmatter?.draft === "true";
  if (isDraft) return "drafts";
  if (slug2.startsWith("apps/") || tags.includes("content/apps")) return "apps";
  if (slug2.startsWith("posts/") || tags.includes("content/post")) return "posts";
  if (slug2.startsWith("wiki/") || tags.includes("content/wiki")) return "wiki";
  return "pages";
}

// src/components/homepageApps.ts
var homepageApps = [
  {
    slug: "apps/iconoplasm/index",
    title: "Iconoplasm",
    description: "Gene personas and visual identities for human protein-coding genes."
  },
  {
    slug: "apps/geneguessr/index",
    title: "GeneGuessr",
    description: "A daily protein guessing game built from structure and function clues."
  }
];
function homepageAppHref(baseUrl, app) {
  return getPublicUrlForSlug(baseUrl, app.slug);
}

// src/components/Date.tsx
function getDate(data) {
  if (!data.defaultDateType) {
    throw new Error(
      `Field 'defaultDateType' was not set. Ensure the CreatedModifiedDate plugin is configured with a 'defaultDateType' option. See https://quartz.jzhao.xyz/plugins/CreatedModifiedDate for more details.`
    );
  }
  return data.dates?.[data.defaultDateType];
}
function formatDate(d2, locale = "en-US") {
  return d2.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}
function Date({ date, locale }) {
  return /* @__PURE__ */ u2("time", { datetime: date.toISOString(), children: formatDate(date, locale) });
}

// src/components/PageList.tsx
function byDateAndAlphabetical() {
  return (f1, f22) => {
    if (f1.dates && f22.dates) {
      return getDate(f22).getTime() - getDate(f1).getTime();
    } else if (f1.dates && !f22.dates) {
      return -1;
    } else if (!f1.dates && f22.dates) {
      return 1;
    }
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? "";
    const f2Title = f22.frontmatter?.title.toLowerCase() ?? "";
    return f1Title.localeCompare(f2Title);
  };
}
function byDateAndAlphabeticalFolderFirst() {
  return (f1, f22) => {
    const f1IsFolder = isFolderPath(f1.slug ?? "");
    const f2IsFolder = isFolderPath(f22.slug ?? "");
    if (f1IsFolder && !f2IsFolder) return -1;
    if (!f1IsFolder && f2IsFolder) return 1;
    if (f1.dates && f22.dates) {
      return getDate(f22).getTime() - getDate(f1).getTime();
    } else if (f1.dates && !f22.dates) {
      return -1;
    } else if (!f1.dates && f22.dates) {
      return 1;
    }
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? "";
    const f2Title = f22.frontmatter?.title.toLowerCase() ?? "";
    return f1Title.localeCompare(f2Title);
  };
}
var PageList = ({ cfg, fileData, allFiles, limit, sort }) => {
  const sorter = sort ?? byDateAndAlphabeticalFolderFirst();
  let list = allFiles.sort(sorter);
  if (limit) {
    list = list.slice(0, limit);
  }
  return /* @__PURE__ */ u2("ul", { class: "section-ul", children: list.map((page) => {
    const title = page.frontmatter?.title;
    const tags = page.frontmatter?.tags ?? [];
    return /* @__PURE__ */ u2("li", { class: "section-li", children: /* @__PURE__ */ u2("div", { class: "section", children: [
      /* @__PURE__ */ u2("p", { class: "meta", children: page.dates && /* @__PURE__ */ u2(Date, { date: getDate(page), locale: cfg.locale }) }),
      /* @__PURE__ */ u2("div", { class: "desc", children: /* @__PURE__ */ u2("h3", { children: /* @__PURE__ */ u2(
        "a",
        {
          href: resolveRelative(fileData.slug, page.slug),
          class: "internal internal-link",
          children: title
        }
      ) }) }),
      /* @__PURE__ */ u2("ul", { class: "tags", children: tags.map((tag) => /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2(
        "a",
        {
          class: "internal tag-link",
          href: resolveRelative(fileData.slug, `tags/${tag}`),
          children: tag
        }
      ) })) })
    ] }) });
  }) });
};
PageList.css = `
.section h3 {
  margin: 0;
}

.section > .tags {
  margin: 0;
}
`;

// src/components/HomepageCrawlFrontier.tsx
var sectionTitles = {
  posts: "Posts",
  apps: "Apps",
  wiki: "Wiki"
};
var sectionTargets = {
  posts: "tags/content/post",
  apps: "apps/index",
  wiki: "tags/content/wiki"
};
var sectionLimits = {
  posts: 4,
  wiki: 4
};
var isMetaInventoryFile = (file) => {
  const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter.tags : [];
  return tags.includes("meta") || tags.includes("content/meta");
};
var sectionIndexSlugs = /* @__PURE__ */ new Set(["posts/index", "wiki/index", "apps/index"]);
var summarize = (description) => {
  if (typeof description !== "string") return null;
  const compact = description.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > 130 ? `${compact.slice(0, 127).trim()}...` : compact;
};
var homepageDescription = (description) => summarize(description);
var HomepageCrawlFrontier_default = (() => {
  const HomepageCrawlFrontier = ({
    cfg,
    fileData,
    allFiles
  }) => {
    if (fileData.slug !== "index") return null;
    const sorted = allFiles.filter(
      (file) => isCrawlableFile(file) && file.slug !== "index" && !sectionIndexSlugs.has(String(file.slug)) && !isMetaInventoryFile(file) && // Drafts stay on tag pages; keep them off the public frontpage.
      classifyCrawlSection(file) !== "drafts"
    ).sort(byDateAndAlphabetical());
    const sections = {
      posts: sorted.filter((file) => classifyCrawlSection(file) === "posts").slice(0, sectionLimits.posts),
      wiki: sorted.filter((file) => classifyCrawlSection(file) === "wiki").slice(0, sectionLimits.wiki)
    };
    const baseUrl = cfg.baseUrl ?? "brinedew.bio";
    return /* @__PURE__ */ u2("nav", { class: "homepage-crawl-frontier", "aria-label": "Site index", children: /* @__PURE__ */ u2("div", { class: "homepage-crawl-frontier__sections", children: [
      ["posts", "wiki"].map(
        (section) => sections[section].length > 0 ? /* @__PURE__ */ u2("section", { children: [
          /* @__PURE__ */ u2("h2", { children: sectionTargets[section] ? /* @__PURE__ */ u2(
            "a",
            {
              class: "internal",
              href: resolveRelative(fileData.slug, sectionTargets[section]),
              children: sectionTitles[section]
            }
          ) : sectionTitles[section] }),
          /* @__PURE__ */ u2("ul", { children: sections[section].map((page) => /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2("a", { class: "internal", href: resolveRelative(fileData.slug, page.slug), children: page.frontmatter?.title ?? page.slug }) })) })
        ] }) : null
      ),
      /* @__PURE__ */ u2("section", { children: [
        /* @__PURE__ */ u2("h2", { children: /* @__PURE__ */ u2("a", { class: "internal", href: resolveRelative(fileData.slug, sectionTargets.apps), children: sectionTitles.apps }) }),
        /* @__PURE__ */ u2("ul", { children: homepageApps.map((app) => /* @__PURE__ */ u2("li", { children: [
          /* @__PURE__ */ u2("a", { href: homepageAppHref(baseUrl, app), children: app.title }),
          homepageDescription(app.description) && /* @__PURE__ */ u2("p", { children: homepageDescription(app.description) })
        ] })) })
      ] })
    ] }) });
  };
  HomepageCrawlFrontier.css = `
.homepage-crawl-frontier {
  margin: 2.5rem 0 0;
}

.homepage-crawl-frontier__sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 2rem;
}

.homepage-crawl-frontier h2 {
  color: var(--darkgray);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0 0 0.75rem;
  text-transform: uppercase;
}

.homepage-crawl-frontier h2 > a {
  color: inherit;
}

.homepage-crawl-frontier ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.homepage-crawl-frontier li {
  margin: 0 0 0.85rem;
}

.homepage-crawl-frontier li > a {
  display: inline-block;
  line-height: 1.2;
}

.homepage-crawl-frontier p {
  color: var(--gray);
  font-size: 0.92rem;
  line-height: 1.35;
  margin: 0.18rem 0 0;
}
`;
  return HomepageCrawlFrontier;
});

// src/components/IconoplasmPageSwitcher.tsx
var DOCS_SECTIONS = [
  "Start here",
  "Bring your own key",
  "Caretakers",
  "Reuse and rights",
  "Updates"
];
function docsHref(slug2) {
  if (!slug2.startsWith("apps/iconoplasm/")) return `https://brinedew.bio/${slug2}`;
  return `/${slug2.slice("apps/iconoplasm/".length).replace(/(?:^|\/)index$/, "")}`;
}
function docsEntries(allFiles) {
  const entries = [];
  for (const file of allFiles) {
    const frontmatter = file.frontmatter ?? {};
    const section = typeof frontmatter.docsSection === "string" ? frontmatter.docsSection : "";
    if (!section || !file.slug) continue;
    entries.push({
      slug: file.slug,
      label: String(frontmatter.docsLabel ?? frontmatter.title ?? file.slug),
      section,
      order: Number(frontmatter.docsOrder ?? 99)
    });
  }
  const rank = (section) => {
    const index = DOCS_SECTIONS.indexOf(section);
    return index === -1 ? DOCS_SECTIONS.length : index;
  };
  return entries.sort(
    (a2, b2) => rank(a2.section) - rank(b2.section) || a2.section.localeCompare(b2.section) || a2.order - b2.order || a2.label.localeCompare(b2.label)
  );
}
function DocsGroups({ docs, slug: slug2 }) {
  const sections = [...new Set(docs.map((doc) => doc.section))];
  return /* @__PURE__ */ u2(S, { children: sections.map((section) => /* @__PURE__ */ u2("div", { class: "icono-docs-group", children: [
    /* @__PURE__ */ u2("span", { class: "icono-docs-section", children: section }),
    /* @__PURE__ */ u2("ul", { children: docs.filter((doc) => doc.section === section).map((doc) => /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2(
      "a",
      {
        href: docsHref(doc.slug),
        class: classNames("icono-docs-link", doc.slug === slug2 && "is-active"),
        "aria-current": doc.slug === slug2 ? "page" : void 0,
        children: doc.label
      }
    ) })) })
  ] })) });
}
var IconoplasmPageSwitcher = ({
  fileData,
  allFiles,
  displayClass
}) => {
  const slug2 = fileData.slug ?? "";
  const isIconoplasmPage = slug2.startsWith("apps/iconoplasm");
  if (!isIconoplasmPage) return null;
  const docs = docsEntries(allFiles);
  const onDocsPage = slug2.startsWith("apps/iconoplasm/docs/") || docs.some((doc) => doc.slug === slug2);
  return /* @__PURE__ */ u2(
    "nav",
    {
      class: classNames(displayClass, "icono-page-switcher"),
      "aria-label": "Iconoplasm sections",
      "data-icono-page-switcher": true,
      children: [
        /* @__PURE__ */ u2("div", { class: "icono-page-tabs", children: [
          /* @__PURE__ */ u2("a", { href: "/", class: "icono-page-tab", "data-icono-nav": true, "data-icono-switch": "archive", children: "Archive" }),
          /* @__PURE__ */ u2("a", { href: "/genes", class: "icono-page-tab", "data-icono-nav": true, "data-icono-switch": "genes", children: "Genes" }),
          /* @__PURE__ */ u2("a", { href: "/studio", class: "icono-page-tab", "data-icono-nav": true, "data-icono-switch": "studio", children: "Studio" }),
          /* @__PURE__ */ u2(
            "a",
            {
              href: "/docs",
              class: classNames("icono-page-tab", onDocsPage && "is-active"),
              "data-icono-switch": "docs",
              "aria-current": slug2 === "apps/iconoplasm/docs/index" ? "page" : void 0,
              children: "Docs"
            }
          )
        ] }),
        onDocsPage && /* @__PURE__ */ u2(S, { children: [
          /* @__PURE__ */ u2("div", { class: "icono-docs-groups", children: /* @__PURE__ */ u2(DocsGroups, { docs, slug: slug2 }) }),
          /* @__PURE__ */ u2(
            "button",
            {
              type: "button",
              class: "icono-docs-menu-button",
              "aria-label": "Docs menu",
              "aria-haspopup": "dialog",
              "aria-controls": "icono-docs-drawer",
              "data-icono-docs-open": true,
              children: /* @__PURE__ */ u2(
                "svg",
                {
                  width: "22",
                  height: "22",
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-width": "2",
                  "stroke-linecap": "round",
                  "aria-hidden": "true",
                  children: /* @__PURE__ */ u2("path", { d: "M4 6h16M4 12h16M4 18h16" })
                }
              )
            }
          ),
          /* @__PURE__ */ u2("dialog", { id: "icono-docs-drawer", class: "icono-docs-drawer", "aria-label": "Docs", children: [
            /* @__PURE__ */ u2("div", { class: "icono-docs-drawer-head", children: [
              /* @__PURE__ */ u2("a", { href: "/docs", children: "Docs" }),
              /* @__PURE__ */ u2("form", { method: "dialog", children: /* @__PURE__ */ u2("button", { type: "submit", "aria-label": "Close", children: /* @__PURE__ */ u2(
                "svg",
                {
                  width: "20",
                  height: "20",
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-width": "2",
                  "stroke-linecap": "round",
                  "aria-hidden": "true",
                  children: /* @__PURE__ */ u2("path", { d: "M6 6l12 12M18 6L6 18" })
                }
              ) }) })
            ] }),
            /* @__PURE__ */ u2(DocsGroups, { docs, slug: slug2 })
          ] })
        ] })
      ]
    }
  );
};
IconoplasmPageSwitcher.afterDOMLoaded = `
(function () {
  function init() {
    var button = document.querySelector("[data-icono-docs-open]");
    var drawer = document.getElementById("icono-docs-drawer");
    if (!button || !drawer || button.dataset.iconoDocsBound === "true") return;
    button.dataset.iconoDocsBound = "true";
    button.addEventListener("click", function () {
      if (!drawer.open) drawer.showModal();
    });
    drawer.addEventListener("click", function (event) {
      if (event.target === drawer || event.target.closest("a")) drawer.close();
    });
  }
  document.addEventListener("nav", init);
})();
`;
IconoplasmPageSwitcher.css = `
.icono-page-switcher {
  margin: 0.25rem 0 0.85rem;
}

.icono-page-switcher .icono-page-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.icono-page-switcher .icono-page-tab {
  display: block;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  background: transparent;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.85rem;
  color: var(--secondary, var(--darkgray));
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.icono-page-switcher .icono-page-tab::before {
  content: none;
}

.icono-page-switcher .icono-page-tab:hover {
  background: color-mix(in srgb, var(--ui-border) 22%, transparent);
  color: var(--dark);
}

.icono-page-switcher .icono-page-tab.is-active,
.icono-page-switcher .icono-page-tab[aria-current="page"] {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.icono-page-switcher .icono-docs-group {
  margin: 0.55rem 0 0 0.6rem;
}

.icono-docs-section {
  display: block;
  padding: 0 0.6rem 0.2rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--gray);
}

.icono-docs-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.icono-docs-link {
  display: block;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  font-size: 0.95rem;
  line-height: 1.3;
  color: var(--darkgray);
  text-decoration: none;
}

.icono-docs-link:hover {
  background: color-mix(in srgb, var(--ui-border) 22%, transparent);
  color: var(--dark);
}

.icono-docs-link.is-active {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.icono-page-switcher .icono-docs-menu-button {
  display: none;
}

/* Phones: the tabs become the row app.js draws on the app's own pages, at the top
   of the page, and the docs list moves into a drawer behind a menu button that
   sits first in the header row. The nav's own box steps aside (display: contents)
   so its parts join the sidebar's flex row and can be ordered there. */
@media (max-width: 800px) {
  /* #quartz-body: Quartz's own phone rule (padding-top: 2rem, gap: 0) is scoped
     under that id and would outrank a class-only selector. No top padding, so the
     tabs sit at the very top, where app.js draws them on the app's own pages. */
  #quartz-body .sidebar.left:has(> .icono-page-switcher) {
    flex-wrap: wrap;
    row-gap: 0.5rem;
    padding-top: 0;
    padding-bottom: 0.75rem;
  }

  /* The logo, search and toggles row fills what the menu button leaves; the
     search box is the part that stretches. Quartz's phone spacer (flex: 2)
     would otherwise take two thirds of the row. */
  .sidebar.left:has(> .icono-page-switcher) > .flex-component {
    flex: 1 1 0;
    min-width: 0;
  }

  .sidebar.left:has(> .icono-page-switcher) .spacer {
    display: none;
  }

  .icono-page-switcher {
    display: contents;
  }

  .icono-page-switcher .icono-page-tabs {
    order: -2;
    flex: 0 0 100%;
    flex-direction: row;
    gap: 0;
    border-bottom: 1px solid var(--ui-border, var(--lightgray));
  }

  /* Same box as app.js's row on the app pages (line height included), so the
     tabs don't jump when you switch between Studio and Docs. */
  .icono-page-switcher .icono-page-tab {
    flex: 1;
    text-align: center;
    padding: 0.6rem 0.4rem;
    line-height: 1.85rem;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    /* !important: Quartz puts component CSS in the quartz-base layer, and the
       blog layer's plain link rule (custom.css, colour and weight 400) outranks
       any selector there. app.js's row is unlayered, so it never meets that. */
    color: var(--secondary, var(--darkgray)) !important;
  }

  .icono-page-switcher .icono-page-tab:hover {
    background: transparent;
  }

  .icono-page-switcher .icono-page-tab.is-active,
  .icono-page-switcher .icono-page-tab[aria-current="page"] {
    background: transparent;
    color: var(--accent) !important;
    font-weight: 600 !important;
    border-bottom-color: var(--accent);
  }

  .icono-page-switcher .icono-docs-groups {
    display: none;
  }

  .icono-page-switcher .icono-docs-menu-button {
    order: -1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin: 0 2px 0 -8px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--darkgray);
    cursor: pointer;
  }
}

.icono-docs-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: min(82vw, 320px);
  height: 100dvh;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0.4rem 0.9rem 2rem;
  border: 0;
  overflow-y: auto;
  background: var(--light);
  color: var(--darkgray);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
  transition:
    transform 0.2s ease,
    overlay 0.2s allow-discrete,
    display 0.2s allow-discrete;
}

.icono-docs-drawer:not([open]) {
  transform: translateX(-100%);
}

@starting-style {
  .icono-docs-drawer[open] {
    transform: translateX(-100%);
  }
}

.icono-docs-drawer::backdrop {
  background: rgba(20, 14, 10, 0.4);
}

@media (prefers-reduced-motion: reduce) {
  .icono-docs-drawer {
    transition: none;
  }
}

html:has(.icono-docs-drawer[open]) {
  overflow: hidden;
}

.icono-docs-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  margin-bottom: 0.3rem;
  border-bottom: 1px solid var(--ui-border, var(--lightgray));
}

.icono-docs-drawer-head a {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--dark);
  text-decoration: none;
}

.icono-docs-drawer-head form {
  margin: 0;
}

.icono-docs-drawer-head button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-right: -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--darkgray);
  cursor: pointer;
}

.icono-docs-drawer .icono-docs-group {
  margin: 0.7rem 0 0;
}

.icono-docs-drawer .icono-docs-link {
  padding: 0.55rem 0.6rem;
  font-size: 1.05rem;
}
`;
var IconoplasmPageSwitcher_default = (() => IconoplasmPageSwitcher);

// src/components/TagSections.tsx
var SECTION_CONFIG = {
  content: { displayName: "Content" },
  topic: { displayName: "Topics" },
  protein: { displayName: "Proteins" },
  meta: { displayName: "Meta" }
};
var TagSections = ({ fileData, displayClass }) => {
  if (String(fileData.slug ?? "").startsWith("apps/")) return null;
  const isDraft = fileData.frontmatter?.draft === true || fileData.frontmatter?.draft === "true";
  const pageTags = isDraft ? ["draft", ...Array.isArray(fileData.frontmatter?.tags) ? fileData.frontmatter.tags : []] : fileData.frontmatter?.tags ?? [];
  if (!Array.isArray(pageTags) || pageTags.length === 0) {
    return null;
  }
  const sections = /* @__PURE__ */ new Map();
  for (const tag of pageTags) {
    if (typeof tag !== "string") continue;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    const parts = normalized.split("/");
    const prefix = parts[0];
    const displayName = parts.length > 1 ? parts.slice(1).join("/") : normalized;
    const sectionKey = parts.length > 1 && SECTION_CONFIG[prefix] ? prefix : "general";
    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, []);
    }
    sections.get(sectionKey).push({ fullPath: normalized, displayName });
  }
  for (const tags of sections.values()) {
    tags.sort((a2, b2) => a2.displayName.localeCompare(b2.displayName));
  }
  const orderedSections = [];
  for (const key of Object.keys(SECTION_CONFIG)) {
    const tags = sections.get(key);
    if (tags && tags.length > 0) {
      orderedSections.push({ key, displayName: SECTION_CONFIG[key].displayName, tags });
    }
  }
  const generalTags = sections.get("general");
  if (generalTags && generalTags.length > 0) {
    orderedSections.push({ key: "general", displayName: "General", tags: generalTags });
  }
  if (orderedSections.length === 0) {
    return null;
  }
  return /* @__PURE__ */ u2("nav", { class: classNames(displayClass, "tag-sections"), children: orderedSections.map((section) => {
    const sectionHref = section.key !== "general" ? resolveRelative(fileData.slug, `tags/${section.key}`) : null;
    return /* @__PURE__ */ u2("div", { class: "tag-section", children: [
      /* @__PURE__ */ u2("h4", { children: sectionHref ? /* @__PURE__ */ u2("a", { href: sectionHref, class: "internal section-link", children: section.displayName }) : section.displayName }),
      /* @__PURE__ */ u2("ul", { children: section.tags.map((tag) => {
        const href = resolveRelative(fileData.slug, `tags/${tag.fullPath}`);
        return /* @__PURE__ */ u2("li", { children: /* @__PURE__ */ u2("a", { href, class: "internal tag-link", children: tag.displayName }) }, tag.fullPath);
      }) })
    ] }, section.key);
  }) });
};
TagSections.css = `
.tag-sections .tag-section {
  margin-bottom: 0.75rem;
}

.tag-sections h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 0.25rem 0;
  padding: 0;
}

.tag-sections h4 a.section-link {
  color: var(--secondary);
  text-decoration: none;
  background: none;
  padding: 0;
  border-radius: 0;
}

.tag-sections h4 a.section-link:hover {
  color: var(--tertiary);
}

.tag-sections ul {
  list-style: none;
  margin: 0;
  padding: 0;
  padding-left: 0.75rem;
}

.tag-sections li {
  padding: 0.1rem 0;
}

.tag-sections a.tag-link {
  color: var(--dark);
  font-size: 0.9rem;
  text-decoration: none;
  background: none;
  padding: 0;
  border-radius: 0;
}

.tag-sections a.tag-link::before {
  content: none;
}

.tag-sections a.tag-link:hover {
  color: var(--tertiary);
}

@media all and (max-width: 800px) {
  .tag-sections {
    display: none;
    position: fixed;
    top: 4rem;
    left: 0;
    right: 0;
    background: var(--light);
    border-bottom: 1px solid var(--lightgray);
    padding: 0.75rem 1rem;
    z-index: 100;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .tag-sections.mobile-open {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .tag-sections .tag-section {
    margin-bottom: 0;
  }

  .tag-sections ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    padding-left: 0;
  }

  .tag-sections li {
    padding: 0;
  }
}
`;
var TagSections_default = (() => TagSections);

// ../../../node_modules/.pnpm/hsluv@1.0.2/node_modules/hsluv/dist/hsluv.mjs
var Hsluv = class _Hsluv {
  constructor() {
    this.hex = "#000000";
    this.rgb_r = 0;
    this.rgb_g = 0;
    this.rgb_b = 0;
    this.xyz_x = 0;
    this.xyz_y = 0;
    this.xyz_z = 0;
    this.luv_l = 0;
    this.luv_u = 0;
    this.luv_v = 0;
    this.lch_l = 0;
    this.lch_c = 0;
    this.lch_h = 0;
    this.hsluv_h = 0;
    this.hsluv_s = 0;
    this.hsluv_l = 0;
    this.hpluv_h = 0;
    this.hpluv_p = 0;
    this.hpluv_l = 0;
    this.r0s = 0;
    this.r0i = 0;
    this.r1s = 0;
    this.r1i = 0;
    this.g0s = 0;
    this.g0i = 0;
    this.g1s = 0;
    this.g1i = 0;
    this.b0s = 0;
    this.b0i = 0;
    this.b1s = 0;
    this.b1i = 0;
  }
  static fromLinear(c2) {
    if (c2 <= 31308e-7) {
      return 12.92 * c2;
    } else {
      return 1.055 * Math.pow(c2, 1 / 2.4) - 0.055;
    }
  }
  static toLinear(c2) {
    if (c2 > 0.04045) {
      return Math.pow((c2 + 0.055) / 1.055, 2.4);
    } else {
      return c2 / 12.92;
    }
  }
  static yToL(Y) {
    if (Y <= _Hsluv.epsilon) {
      return Y / _Hsluv.refY * _Hsluv.kappa;
    } else {
      return 116 * Math.pow(Y / _Hsluv.refY, 1 / 3) - 16;
    }
  }
  static lToY(L2) {
    if (L2 <= 8) {
      return _Hsluv.refY * L2 / _Hsluv.kappa;
    } else {
      return _Hsluv.refY * Math.pow((L2 + 16) / 116, 3);
    }
  }
  static rgbChannelToHex(chan) {
    const c2 = Math.round(chan * 255);
    const digit2 = c2 % 16;
    const digit1 = (c2 - digit2) / 16 | 0;
    return _Hsluv.hexChars.charAt(digit1) + _Hsluv.hexChars.charAt(digit2);
  }
  static hexToRgbChannel(hex, offset) {
    const digit1 = _Hsluv.hexChars.indexOf(hex.charAt(offset));
    const digit2 = _Hsluv.hexChars.indexOf(hex.charAt(offset + 1));
    const n2 = digit1 * 16 + digit2;
    return n2 / 255;
  }
  static distanceFromOriginAngle(slope, intercept, angle) {
    const d2 = intercept / (Math.sin(angle) - slope * Math.cos(angle));
    if (d2 < 0) {
      return Infinity;
    } else {
      return d2;
    }
  }
  static distanceFromOrigin(slope, intercept) {
    return Math.abs(intercept) / Math.sqrt(Math.pow(slope, 2) + 1);
  }
  static min6(f1, f22, f3, f4, f5, f6) {
    return Math.min(f1, Math.min(f22, Math.min(f3, Math.min(f4, Math.min(f5, f6)))));
  }
  rgbToHex() {
    this.hex = "#";
    this.hex += _Hsluv.rgbChannelToHex(this.rgb_r);
    this.hex += _Hsluv.rgbChannelToHex(this.rgb_g);
    this.hex += _Hsluv.rgbChannelToHex(this.rgb_b);
  }
  hexToRgb() {
    this.hex = this.hex.toLowerCase();
    this.rgb_r = _Hsluv.hexToRgbChannel(this.hex, 1);
    this.rgb_g = _Hsluv.hexToRgbChannel(this.hex, 3);
    this.rgb_b = _Hsluv.hexToRgbChannel(this.hex, 5);
  }
  xyzToRgb() {
    this.rgb_r = _Hsluv.fromLinear(_Hsluv.m_r0 * this.xyz_x + _Hsluv.m_r1 * this.xyz_y + _Hsluv.m_r2 * this.xyz_z);
    this.rgb_g = _Hsluv.fromLinear(_Hsluv.m_g0 * this.xyz_x + _Hsluv.m_g1 * this.xyz_y + _Hsluv.m_g2 * this.xyz_z);
    this.rgb_b = _Hsluv.fromLinear(_Hsluv.m_b0 * this.xyz_x + _Hsluv.m_b1 * this.xyz_y + _Hsluv.m_b2 * this.xyz_z);
  }
  rgbToXyz() {
    const lr = _Hsluv.toLinear(this.rgb_r);
    const lg = _Hsluv.toLinear(this.rgb_g);
    const lb = _Hsluv.toLinear(this.rgb_b);
    this.xyz_x = 0.41239079926595 * lr + 0.35758433938387 * lg + 0.18048078840183 * lb;
    this.xyz_y = 0.21263900587151 * lr + 0.71516867876775 * lg + 0.072192315360733 * lb;
    this.xyz_z = 0.019330818715591 * lr + 0.11919477979462 * lg + 0.95053215224966 * lb;
  }
  xyzToLuv() {
    const divider = this.xyz_x + 15 * this.xyz_y + 3 * this.xyz_z;
    let varU = 4 * this.xyz_x;
    let varV = 9 * this.xyz_y;
    if (divider !== 0) {
      varU /= divider;
      varV /= divider;
    } else {
      varU = NaN;
      varV = NaN;
    }
    this.luv_l = _Hsluv.yToL(this.xyz_y);
    if (this.luv_l === 0) {
      this.luv_u = 0;
      this.luv_v = 0;
    } else {
      this.luv_u = 13 * this.luv_l * (varU - _Hsluv.refU);
      this.luv_v = 13 * this.luv_l * (varV - _Hsluv.refV);
    }
  }
  luvToXyz() {
    if (this.luv_l === 0) {
      this.xyz_x = 0;
      this.xyz_y = 0;
      this.xyz_z = 0;
      return;
    }
    const varU = this.luv_u / (13 * this.luv_l) + _Hsluv.refU;
    const varV = this.luv_v / (13 * this.luv_l) + _Hsluv.refV;
    this.xyz_y = _Hsluv.lToY(this.luv_l);
    this.xyz_x = 0 - 9 * this.xyz_y * varU / ((varU - 4) * varV - varU * varV);
    this.xyz_z = (9 * this.xyz_y - 15 * varV * this.xyz_y - varV * this.xyz_x) / (3 * varV);
  }
  luvToLch() {
    this.lch_l = this.luv_l;
    this.lch_c = Math.sqrt(this.luv_u * this.luv_u + this.luv_v * this.luv_v);
    if (this.lch_c < 1e-8) {
      this.lch_h = 0;
    } else {
      const hrad = Math.atan2(this.luv_v, this.luv_u);
      this.lch_h = hrad * 180 / Math.PI;
      if (this.lch_h < 0) {
        this.lch_h = 360 + this.lch_h;
      }
    }
  }
  lchToLuv() {
    const hrad = this.lch_h / 180 * Math.PI;
    this.luv_l = this.lch_l;
    this.luv_u = Math.cos(hrad) * this.lch_c;
    this.luv_v = Math.sin(hrad) * this.lch_c;
  }
  calculateBoundingLines(l2) {
    const sub1 = Math.pow(l2 + 16, 3) / 1560896;
    const sub2 = sub1 > _Hsluv.epsilon ? sub1 : l2 / _Hsluv.kappa;
    const s1r = sub2 * (284517 * _Hsluv.m_r0 - 94839 * _Hsluv.m_r2);
    const s2r = sub2 * (838422 * _Hsluv.m_r2 + 769860 * _Hsluv.m_r1 + 731718 * _Hsluv.m_r0);
    const s3r = sub2 * (632260 * _Hsluv.m_r2 - 126452 * _Hsluv.m_r1);
    const s1g = sub2 * (284517 * _Hsluv.m_g0 - 94839 * _Hsluv.m_g2);
    const s2g = sub2 * (838422 * _Hsluv.m_g2 + 769860 * _Hsluv.m_g1 + 731718 * _Hsluv.m_g0);
    const s3g = sub2 * (632260 * _Hsluv.m_g2 - 126452 * _Hsluv.m_g1);
    const s1b = sub2 * (284517 * _Hsluv.m_b0 - 94839 * _Hsluv.m_b2);
    const s2b = sub2 * (838422 * _Hsluv.m_b2 + 769860 * _Hsluv.m_b1 + 731718 * _Hsluv.m_b0);
    const s3b = sub2 * (632260 * _Hsluv.m_b2 - 126452 * _Hsluv.m_b1);
    this.r0s = s1r / s3r;
    this.r0i = s2r * l2 / s3r;
    this.r1s = s1r / (s3r + 126452);
    this.r1i = (s2r - 769860) * l2 / (s3r + 126452);
    this.g0s = s1g / s3g;
    this.g0i = s2g * l2 / s3g;
    this.g1s = s1g / (s3g + 126452);
    this.g1i = (s2g - 769860) * l2 / (s3g + 126452);
    this.b0s = s1b / s3b;
    this.b0i = s2b * l2 / s3b;
    this.b1s = s1b / (s3b + 126452);
    this.b1i = (s2b - 769860) * l2 / (s3b + 126452);
  }
  calcMaxChromaHpluv() {
    const r0 = _Hsluv.distanceFromOrigin(this.r0s, this.r0i);
    const r1 = _Hsluv.distanceFromOrigin(this.r1s, this.r1i);
    const g0 = _Hsluv.distanceFromOrigin(this.g0s, this.g0i);
    const g1 = _Hsluv.distanceFromOrigin(this.g1s, this.g1i);
    const b0 = _Hsluv.distanceFromOrigin(this.b0s, this.b0i);
    const b1 = _Hsluv.distanceFromOrigin(this.b1s, this.b1i);
    return _Hsluv.min6(r0, r1, g0, g1, b0, b1);
  }
  calcMaxChromaHsluv(h2) {
    const hueRad = h2 / 360 * Math.PI * 2;
    const r0 = _Hsluv.distanceFromOriginAngle(this.r0s, this.r0i, hueRad);
    const r1 = _Hsluv.distanceFromOriginAngle(this.r1s, this.r1i, hueRad);
    const g0 = _Hsluv.distanceFromOriginAngle(this.g0s, this.g0i, hueRad);
    const g1 = _Hsluv.distanceFromOriginAngle(this.g1s, this.g1i, hueRad);
    const b0 = _Hsluv.distanceFromOriginAngle(this.b0s, this.b0i, hueRad);
    const b1 = _Hsluv.distanceFromOriginAngle(this.b1s, this.b1i, hueRad);
    return _Hsluv.min6(r0, r1, g0, g1, b0, b1);
  }
  hsluvToLch() {
    if (this.hsluv_l > 99.9999999) {
      this.lch_l = 100;
      this.lch_c = 0;
    } else if (this.hsluv_l < 1e-8) {
      this.lch_l = 0;
      this.lch_c = 0;
    } else {
      this.lch_l = this.hsluv_l;
      this.calculateBoundingLines(this.hsluv_l);
      const max = this.calcMaxChromaHsluv(this.hsluv_h);
      this.lch_c = max / 100 * this.hsluv_s;
    }
    this.lch_h = this.hsluv_h;
  }
  lchToHsluv() {
    if (this.lch_l > 99.9999999) {
      this.hsluv_s = 0;
      this.hsluv_l = 100;
    } else if (this.lch_l < 1e-8) {
      this.hsluv_s = 0;
      this.hsluv_l = 0;
    } else {
      this.calculateBoundingLines(this.lch_l);
      const max = this.calcMaxChromaHsluv(this.lch_h);
      this.hsluv_s = this.lch_c / max * 100;
      this.hsluv_l = this.lch_l;
    }
    this.hsluv_h = this.lch_h;
  }
  hpluvToLch() {
    if (this.hpluv_l > 99.9999999) {
      this.lch_l = 100;
      this.lch_c = 0;
    } else if (this.hpluv_l < 1e-8) {
      this.lch_l = 0;
      this.lch_c = 0;
    } else {
      this.lch_l = this.hpluv_l;
      this.calculateBoundingLines(this.hpluv_l);
      const max = this.calcMaxChromaHpluv();
      this.lch_c = max / 100 * this.hpluv_p;
    }
    this.lch_h = this.hpluv_h;
  }
  lchToHpluv() {
    if (this.lch_l > 99.9999999) {
      this.hpluv_p = 0;
      this.hpluv_l = 100;
    } else if (this.lch_l < 1e-8) {
      this.hpluv_p = 0;
      this.hpluv_l = 0;
    } else {
      this.calculateBoundingLines(this.lch_l);
      const max = this.calcMaxChromaHpluv();
      this.hpluv_p = this.lch_c / max * 100;
      this.hpluv_l = this.lch_l;
    }
    this.hpluv_h = this.lch_h;
  }
  hsluvToRgb() {
    this.hsluvToLch();
    this.lchToLuv();
    this.luvToXyz();
    this.xyzToRgb();
  }
  hpluvToRgb() {
    this.hpluvToLch();
    this.lchToLuv();
    this.luvToXyz();
    this.xyzToRgb();
  }
  hsluvToHex() {
    this.hsluvToRgb();
    this.rgbToHex();
  }
  hpluvToHex() {
    this.hpluvToRgb();
    this.rgbToHex();
  }
  rgbToHsluv() {
    this.rgbToXyz();
    this.xyzToLuv();
    this.luvToLch();
    this.lchToHpluv();
    this.lchToHsluv();
  }
  rgbToHpluv() {
    this.rgbToXyz();
    this.xyzToLuv();
    this.luvToLch();
    this.lchToHpluv();
    this.lchToHpluv();
  }
  hexToHsluv() {
    this.hexToRgb();
    this.rgbToHsluv();
  }
  hexToHpluv() {
    this.hexToRgb();
    this.rgbToHpluv();
  }
};
Hsluv.hexChars = "0123456789abcdef";
Hsluv.refY = 1;
Hsluv.refU = 0.19783000664283;
Hsluv.refV = 0.46831999493879;
Hsluv.kappa = 903.2962962;
Hsluv.epsilon = 0.0088564516;
Hsluv.m_r0 = 3.240969941904521;
Hsluv.m_r1 = -1.537383177570093;
Hsluv.m_r2 = -0.498610760293;
Hsluv.m_g0 = -0.96924363628087;
Hsluv.m_g1 = 1.87596750150772;
Hsluv.m_g2 = 0.041555057407175;
Hsluv.m_b0 = 0.055630079696993;
Hsluv.m_b1 = -0.20397695888897;
Hsluv.m_b2 = 1.056971514242878;

// src/components/ProteinInfobox.tsx
var MAPPINGS = [
  { source: "mass", target: "height" },
  { source: "Has transmembrane domains", target: "Sex" },
  { source: "membrane_depth", target: "background_setting" },
  { source: "alignment", target: "Politics" },
  { source: "first_letter", target: "Skintone Hue " },
  { source: "rvis_percentile", target: "Skintone Lightness" },
  { source: "tissue_tau", target: "Skintone Saturation" },
  { source: "kegg_families", target: "Aesthetics" },
  { source: "percent_disordered", target: "Age" }
];
var ProteinInfobox = ({ fileData, displayClass }) => {
  const fm = fileData.frontmatter ?? {};
  const tagList = Array.isArray(fm.tags) ? fm.tags : [];
  if (!tagList.includes("protein")) {
    return null;
  }
  const mappings = MAPPINGS;
  const toStringValue = (value, fallback = "") => {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return fallback;
  };
  const toNumberValue = (value, fallback = 0) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  };
  const visibleMappings = mappings.filter((m2) => {
    const molecularValue = fm?.[m2.source];
    const targetNormalized = m2.target.toLowerCase().replace(/\s+/g, "_").replace(/_+$/, "");
    const personaKey = `persona_${targetNormalized}`;
    const personaValue = fm?.[personaKey];
    const hasMolecular = molecularValue !== void 0 && molecularValue !== null && molecularValue !== "" && String(molecularValue).toLowerCase() !== "nan";
    const hasPersona = personaValue !== void 0 && personaValue !== null && personaValue !== "" && String(personaValue).toLowerCase() !== "nan";
    return hasMolecular && hasPersona;
  });
  const personaImage = toStringValue(fm.persona_image) || (typeof fm.uniprot_id === "string" ? `/static/proteins/${fm.uniprot_id}.png` : "");
  const toHexHsluv = (h2, s2, l2) => {
    const hue = (h2 % 360 + 360) % 360;
    const sat = Math.max(0, Math.min(100, s2));
    const lum = Math.max(0, Math.min(100, l2));
    const conv = new Hsluv();
    conv.hsluv_h = hue;
    conv.hsluv_s = sat;
    conv.hsluv_l = lum;
    conv.hsluvToHex();
    return conv.hex;
  };
  let hexcode = toStringValue(fm.persona_hexcode);
  if (!hexcode || hexcode === "null") {
    const hue = toNumberValue(fm.persona_skintone_hue, 0);
    const sat = toNumberValue(fm.persona_skintone_saturation, 50);
    const light = toNumberValue(fm.persona_skintone_lightness, 50);
    hexcode = toHexHsluv(hue, sat, light);
  }
  const geneSymbol = toStringValue(fm.symbol) || toStringValue(fm.gene_symbol) || toStringValue(fm.title, "Protein");
  const prettifyLabel = (fieldName) => {
    const labelMap = {
      mass: "Mass",
      length: "Length",
      percent_disordered: "Disorder",
      rvis_percentile: "RVIS",
      alignment: "Classification",
      first_letter: "First Letter",
      "Has transmembrane domains": "Transmembrane",
      membrane_depth: "Membrane Depth",
      tissue_tau: "Tissue Specificity",
      height: "Height",
      Sex: "Gender",
      Politics: "Politics",
      "Skintone Hue ": "Skin Hue",
      "Skintone Saturation": "Skin Saturation",
      "Skintone Lightness": "Skin Lightness",
      Aesthetics: "Aesthetics",
      background_setting: "Setting",
      Age: "Age"
    };
    return labelMap[fieldName] || fieldName;
  };
  const formatValue = (fieldName, value) => {
    const unitMap = {
      mass: " kDa",
      length: " aa",
      percent_disordered: "%",
      rvis_percentile: "",
      height: " cm",
      Age: "",
      "Skintone Hue ": "",
      "Skintone Saturation": "%",
      "Skintone Lightness": "%"
    };
    const unit = unitMap[fieldName] || "";
    return `${value}${unit}`;
  };
  return /* @__PURE__ */ u2("div", { class: classNames(displayClass, "protein-infobox"), children: [
    /* @__PURE__ */ u2("div", { class: "infobox-image-container", children: /* @__PURE__ */ u2("div", { class: "infobox-image", style: `background-color: ${hexcode}`, children: [
      /* @__PURE__ */ u2(
        "img",
        {
          src: personaImage,
          alt: `${geneSymbol} persona portrait`,
          onError: (e2) => {
            const target = e2.target;
            target.style.display = "none";
            const placeholder = target.nextElementSibling;
            if (placeholder) placeholder.style.display = "flex";
          }
        }
      ),
      /* @__PURE__ */ u2(
        "div",
        {
          class: "infobox-image-placeholder",
          style: `background-color: ${hexcode}; display: none;`,
          children: geneSymbol
        }
      )
    ] }) }),
    /* @__PURE__ */ u2("div", { class: "infobox-title", children: /* @__PURE__ */ u2("h3", { children: geneSymbol }) }),
    visibleMappings.length > 0 && /* @__PURE__ */ u2("div", { class: "infobox-mappings", children: [
      /* @__PURE__ */ u2("div", { class: "mapping-header", children: [
        /* @__PURE__ */ u2("span", { class: "mapping-col-title", children: "Molecular" }),
        /* @__PURE__ */ u2("span", { class: "mapping-arrow", children: "\u2192" }),
        /* @__PURE__ */ u2("span", { class: "mapping-col-title", children: "Persona" })
      ] }),
      visibleMappings.map((m2) => {
        const targetNormalized = m2.target.toLowerCase().replace(/\s+/g, "_").replace(/_+$/, "");
        const personaKey = `persona_${targetNormalized}`;
        const molecularValue = fm[m2.source];
        const personaValue = fm[personaKey];
        const isHueMapping = m2.source === "first_letter" && m2.target === "Skintone Hue ";
        let personaDisplay = formatValue(m2.target, personaValue);
        if (isHueMapping) {
          const hue = fm?.persona_skintone_hue || 0;
          const letter = (molecularValue || "X").toUpperCase();
          const hueColor = toHexHsluv(hue, 100, 50);
          const letterCode = letter.charCodeAt(0);
          let enclosedChar = letter;
          if (letterCode >= 65 && letterCode <= 90) {
            enclosedChar = String.fromCodePoint(127344 + (letterCode - 65));
          }
          return /* @__PURE__ */ u2("div", { class: "mapping-row", children: [
            /* @__PURE__ */ u2("div", { class: "mapping-molecular", children: [
              /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m2.source) }),
              /* @__PURE__ */ u2("span", { class: "mapping-value", children: letter })
            ] }),
            /* @__PURE__ */ u2("span", { class: "mapping-arrow", children: "\u2192" }),
            /* @__PURE__ */ u2("div", { class: "mapping-persona", children: [
              /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m2.target) }),
              /* @__PURE__ */ u2("span", { class: "mapping-value", children: /* @__PURE__ */ u2("span", { class: "hue-letter", style: `color: ${hueColor}; font-size: 1.4rem;`, children: enclosedChar }) })
            ] })
          ] });
        }
        return /* @__PURE__ */ u2("div", { class: "mapping-row", children: [
          /* @__PURE__ */ u2("div", { class: "mapping-molecular", children: [
            /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m2.source) }),
            /* @__PURE__ */ u2("span", { class: "mapping-value", children: formatValue(m2.source, molecularValue) })
          ] }),
          /* @__PURE__ */ u2("span", { class: "mapping-arrow", children: "\u2192" }),
          /* @__PURE__ */ u2("div", { class: "mapping-persona", children: [
            /* @__PURE__ */ u2("span", { class: "mapping-label", children: prettifyLabel(m2.target) }),
            /* @__PURE__ */ u2("span", { class: "mapping-value", children: personaDisplay })
          ] })
        ] });
      })
    ] }),
    fm?.uniprot_id && /* @__PURE__ */ u2("div", { class: "infobox-footer", children: /* @__PURE__ */ u2(
      "a",
      {
        href: `https://www.uniprot.org/uniprotkb/${fm.uniprot_id}`,
        target: "_blank",
        rel: "noopener",
        children: [
          "UniProt: ",
          fm.uniprot_id
        ]
      }
    ) })
  ] });
};
ProteinInfobox.css = `
.protein-infobox {
  float: right;
  width: 320px;
  margin: 0 0 1.5rem 1.5rem;
  border: 1px solid var(--border);
  background: var(--light);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.9rem;
  clear: right;
}

.protein-infobox.in-gallery {
  float: none !important;
  width: 100% !important;
  margin: 0 !important;
  clear: none !important;
}

.infobox-image-container {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  overflow: hidden;
}

.infobox-image {
  width: 100%;
  height: 100%;
  position: relative;
}

.infobox-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.infobox-image-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 600;
  color: var(--light);
  text-align: center;
  padding: 1rem;
}

.infobox-title {
  padding: 1rem;
  text-align: center;
  border-bottom: 1px solid var(--border);
  background: var(--lightgray);
}

.infobox-title h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--dark);
}

.infobox-mappings {
  padding: 1rem;
}

.mapping-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--border);
}

.mapping-col-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--darkgray);
  text-align: center;
}

.mapping-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--lightgray);
}

.mapping-row:last-child {
  border-bottom: none;
}

.mapping-molecular,
.mapping-persona {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: center;
  align-items: center;
}

.mapping-label {
  font-size: 0.7rem;
  color: var(--darkgray);
  font-weight: 500;
  text-align: center;
}

.mapping-value {
  font-size: 0.85rem;
  color: var(--dark);
  font-weight: 600;
  text-align: center;
}

.hue-letter {
  display: inline-block;
  line-height: 1;
}

.mapping-arrow {
  color: var(--accent);
  font-weight: bold;
  font-size: 1rem;
  text-align: center;
}

.infobox-footer {
  padding: 0.75rem 1rem;
  background: var(--highlight);
  border-top: 1px solid var(--border);
  text-align: center;
}

.infobox-footer a {
  color: var(--secondary);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
}

.infobox-footer a:hover {
  text-decoration: underline;
}

@media (max-width: 800px) {
  .protein-infobox {
    float: none;
    width: 100%;
    margin: 1rem 0;
  }
}
`;
var ProteinInfobox_default = (() => ProteinInfobox);

// src/components/ContactForm.tsx
var ContactForm = (opts = {}) => {
  const endpoint = opts.endpoint || "/api/contact";
  const Component = ({ fileData }) => {
    const frontmatter = fileData?.frontmatter || null;
    const aliases = ["contact", "contactForm", "showContactForm"];
    const wantsForm = Array.isArray(frontmatter) ? frontmatter.some((v2) => aliases.includes(String(v2))) : frontmatter && typeof frontmatter === "object" ? aliases.some((k2) => Boolean(frontmatter[k2])) : false;
    if (!wantsForm) return null;
    return /* @__PURE__ */ u2("div", { class: "contact-form-card", "data-contact-form-root": true, "data-endpoint": endpoint, children: /* @__PURE__ */ u2(
      "form",
      {
        class: "contact-form",
        "data-contact-form": true,
        action: endpoint,
        method: "post",
        acceptCharset: "UTF-8",
        children: [
          /* @__PURE__ */ u2("label", { class: "contact-form__field", children: [
            /* @__PURE__ */ u2("span", { class: "contact-form__label", children: "Email" }),
            /* @__PURE__ */ u2(
              "input",
              {
                class: "contact-form__input",
                type: "email",
                name: "email",
                required: true,
                maxLength: 254,
                autocomplete: "email",
                placeholder: "you@example.com"
              }
            )
          ] }),
          /* @__PURE__ */ u2("label", { class: "contact-form__field", children: [
            /* @__PURE__ */ u2("span", { class: "contact-form__label", children: "Message" }),
            /* @__PURE__ */ u2(
              "textarea",
              {
                class: "contact-form__textarea",
                name: "message",
                required: true,
                minLength: 10,
                rows: 6,
                maxLength: 5e3
              }
            )
          ] }),
          /* @__PURE__ */ u2("div", { class: "contact-form__honeypot", "aria-hidden": "true", children: [
            /* @__PURE__ */ u2("label", { children: [
              "Website",
              /* @__PURE__ */ u2(
                "input",
                {
                  type: "text",
                  name: "website",
                  tabIndex: -1,
                  autocomplete: "off",
                  "aria-hidden": "true"
                }
              )
            ] }),
            /* @__PURE__ */ u2("label", { children: [
              "Affiliation",
              /* @__PURE__ */ u2(
                "input",
                {
                  type: "text",
                  name: "affiliation",
                  tabIndex: -1,
                  autocomplete: "off",
                  "aria-hidden": "true"
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ u2("div", { class: "contact-form__actions", children: /* @__PURE__ */ u2("button", { class: "contact-form__submit", type: "submit", "data-contact-form-submit": true, children: "Send" }) }),
          /* @__PURE__ */ u2(
            "p",
            {
              class: "contact-form__status",
              "data-contact-form-status": true,
              "data-tone": "neutral",
              "aria-live": "polite",
              role: "status"
            }
          ),
          /* @__PURE__ */ u2(
            "p",
            {
              id: "contact-sent",
              class: "contact-form__status contact-form__fallback-status",
              "data-tone": "ok",
              role: "status",
              children: "Thanks \u2014 your message is on its way to my inbox."
            }
          ),
          /* @__PURE__ */ u2(
            "p",
            {
              id: "contact-invalid",
              class: "contact-form__status contact-form__fallback-status",
              "data-tone": "error",
              role: "status",
              children: "Check your email address and write a message of at least 10 characters (two or more words)."
            }
          ),
          /* @__PURE__ */ u2(
            "p",
            {
              id: "contact-limited",
              class: "contact-form__status contact-form__fallback-status",
              "data-tone": "error",
              role: "status",
              children: "Too many submissions. Try again in a minute."
            }
          ),
          /* @__PURE__ */ u2(
            "p",
            {
              id: "contact-failed",
              class: "contact-form__status contact-form__fallback-status",
              "data-tone": "error",
              role: "status",
              children: "The message could not be sent. Please try again later."
            }
          )
        ]
      }
    ) });
  };
  Component.displayName = "ContactForm";
  Component.css = `
.contact-form-card {
  margin: 2.25rem 0 1.5rem;
  padding: 1.75rem 1.5rem 1.5rem;
  border: 1px solid var(--gray);
  border-radius: 16px;
  background: var(--light);
  max-width: 36rem;
}

.contact-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.contact-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.contact-form__label {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--darkgray);
}

.contact-form__input,
.contact-form__textarea {
  font: inherit;
  color: var(--dark);
  background: var(--lightgray);
  border: 1px solid var(--gray);
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.contact-form__textarea {
  resize: vertical;
  min-height: 6.5rem;
  font-family: inherit;
  line-height: 1.5;
}

.contact-form__input:focus,
.contact-form__textarea:focus {
  outline: none;
  border-color: var(--tertiary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tertiary) 25%, transparent);
}

.contact-form__honeypot {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.contact-form__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.contact-form__submit {
  font: inherit;
  font-weight: 600;
  color: var(--light);
  background: var(--tertiary);
  border: 1px solid var(--tertiary);
  border-radius: 8px;
  padding: 0.7rem 1.2rem;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}

.contact-form__submit:hover:not(:disabled) {
  filter: brightness(0.95);
}

.contact-form__submit:active:not(:disabled) {
  transform: translateY(1px);
}

.contact-form__submit:disabled {
  opacity: 0.6;
  cursor: progress;
}

.contact-form__status {
  margin: 0;
  min-height: 1.25rem;
  font-size: 0.92rem;
  color: var(--darkgray);
  line-height: 1.4;
}

.contact-form__status[data-tone="ok"] {
  color: oklch(45% 0.12 150);
}

.contact-form__status[data-tone="error"] {
  color: oklch(50% 0.18 25);
}

.contact-form__fallback-status:not(:target) {
  display: none;
}

.contact-form[data-contact-form-enhanced="true"] .contact-form__fallback-status {
  display: none;
}
`;
  Component.afterDOMLoaded = `
(function () {
  function attach(root) {
    if (!root) return;
    var form = root.querySelector("[data-contact-form]");
    if (!form || form.dataset.contactFormEnhanced === "true") return;
    var endpoint = root.getAttribute("data-endpoint") || "/api/contact";
    var status = root.querySelector("[data-contact-form-status]");
    var submit = root.querySelector("[data-contact-form-submit]");
    var mountedAt = Date.now();

    function setStatus(message, tone) {
      if (!status) return;
      status.textContent = String(message || "");
      status.setAttribute("data-tone", tone || "neutral");
    }

    var fallbackId =
      window.location && typeof window.location.hash === "string"
        ? window.location.hash.slice(1)
        : "";
    if (
      fallbackId === "contact-sent" ||
      fallbackId === "contact-invalid" ||
      fallbackId === "contact-limited" ||
      fallbackId === "contact-failed"
    ) {
      var fallback = root.querySelector("#" + fallbackId);
      if (fallback) {
        setStatus(fallback.textContent.trim(), fallback.getAttribute("data-tone") || "neutral");
      }
    }
    form.dataset.contactFormEnhanced = "true";

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var emailInput = form.querySelector("input[name='email']");
      var messageInput = form.querySelector("textarea[name='message']");
      var honeypot = form.querySelector("input[name='website']");
      var affiliation = form.querySelector("input[name='affiliation']");

      var email = emailInput ? String(emailInput.value || "").trim() : "";
      var message = messageInput ? String(messageInput.value || "").trim() : "";

      if (!email) {
        setStatus("Enter your email.", "error");
        if (emailInput) emailInput.focus();
        return;
      }
      if (!message || message.length < 10 || !/S+s+S+/.test(message)) {
        setStatus("Write a message of at least 10 characters (two or more words).", "error");
        if (messageInput) messageInput.focus();
        return;
      }

      if (submit) submit.disabled = true;
      setStatus("Sending\u2026", "neutral");

      var payload = {
        email: email,
        message: message,
        website: honeypot ? String(honeypot.value || "") : "",
        affiliation: affiliation ? String(affiliation.value || "") : "",
        elapsedMs: Math.max(0, Date.now() - mountedAt),
      };

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (resp) {
          return resp.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (_e) { data = { raw: text }; }
            return { ok: resp.ok, status: resp.status, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            setStatus("Thanks \u2014 your message is on its way to my inbox.", "ok");
            form.reset();
          } else {
            var msg = (result.data && result.data.error) ? result.data.error : ("HTTP " + result.status);
            setStatus(msg, "error");
          }
        })
        .catch(function (err) {
          setStatus(String((err && err.message) || err || "Submission failed."), "error");
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  function init() {
    var roots = document.querySelectorAll("[data-contact-form-root]");
    for (var i = 0; i < roots.length; i++) attach(roots[i]);
  }

  document.addEventListener("nav", init);
})();
`;
  return Component;
};
var ContactForm_default = ContactForm;

// ../../../node_modules/.pnpm/unist-util-is@6.0.1/node_modules/unist-util-is/lib/index.js
var convert = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends string>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & {type: Condition}) &
   *   (<Condition extends Props>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Condition) &
   *   (<Condition extends TestFunction>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Predicate<Condition, Node>) &
   *   ((test?: null | undefined) => (node?: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test} [test]
   * @returns {Check}
   */
  (function(test) {
    if (test === null || test === void 0) {
      return ok;
    }
    if (typeof test === "function") {
      return castFactory(test);
    }
    if (typeof test === "object") {
      return Array.isArray(test) ? anyFactory(test) : (
        // Cast because `ReadonlyArray` goes into the above but `isArray`
        // narrows to `Array`.
        propertiesFactory(
          /** @type {Props} */
          test
        )
      );
    }
    if (typeof test === "string") {
      return typeFactory(test);
    }
    throw new Error("Expected function, string, or object as test");
  })
);
function anyFactory(tests) {
  const checks = [];
  let index = -1;
  while (++index < tests.length) {
    checks[index] = convert(tests[index]);
  }
  return castFactory(any);
  function any(...parameters) {
    let index2 = -1;
    while (++index2 < checks.length) {
      if (checks[index2].apply(this, parameters)) return true;
    }
    return false;
  }
}
function propertiesFactory(check) {
  const checkAsRecord = (
    /** @type {Record<string, unknown>} */
    check
  );
  return castFactory(all);
  function all(node) {
    const nodeAsRecord = (
      /** @type {Record<string, unknown>} */
      /** @type {unknown} */
      node
    );
    let key;
    for (key in check) {
      if (nodeAsRecord[key] !== checkAsRecord[key]) return false;
    }
    return true;
  }
}
function typeFactory(check) {
  return castFactory(type);
  function type(node) {
    return node && node.type === check;
  }
}
function castFactory(testFunction) {
  return check;
  function check(value, index, parent) {
    return Boolean(
      looksLikeANode(value) && testFunction.call(
        this,
        value,
        typeof index === "number" ? index : void 0,
        parent || void 0
      )
    );
  }
}
function ok() {
  return true;
}
function looksLikeANode(value) {
  return value !== null && typeof value === "object" && "type" in value;
}

// ../../../node_modules/.pnpm/unist-util-visit-parents@6.0.2/node_modules/unist-util-visit-parents/lib/color.node.js
function color(d2) {
  return "\x1B[33m" + d2 + "\x1B[39m";
}

// ../../../node_modules/.pnpm/unist-util-visit-parents@6.0.2/node_modules/unist-util-visit-parents/lib/index.js
var empty = [];
var CONTINUE = true;
var EXIT = false;
var SKIP = "skip";
function visitParents(tree, test, visitor, reverse) {
  let check;
  if (typeof test === "function" && typeof visitor !== "function") {
    reverse = visitor;
    visitor = test;
  } else {
    check = test;
  }
  const is2 = convert(check);
  const step = reverse ? -1 : 1;
  factory(tree, void 0, [])();
  function factory(node, index, parents) {
    const value = (
      /** @type {Record<string, unknown>} */
      node && typeof node === "object" ? node : {}
    );
    if (typeof value.type === "string") {
      const name = (
        // `hast`
        typeof value.tagName === "string" ? value.tagName : (
          // `xast`
          typeof value.name === "string" ? value.name : void 0
        )
      );
      Object.defineProperty(visit2, "name", {
        value: "node (" + color(node.type + (name ? "<" + name + ">" : "")) + ")"
      });
    }
    return visit2;
    function visit2() {
      let result = empty;
      let subresult;
      let offset;
      let grandparents;
      if (!test || is2(node, index, parents[parents.length - 1] || void 0)) {
        result = toResult(visitor(node, parents));
        if (result[0] === EXIT) {
          return result;
        }
      }
      if ("children" in node && node.children) {
        const nodeAsParent = (
          /** @type {UnistParent} */
          node
        );
        if (nodeAsParent.children && result[0] !== SKIP) {
          offset = (reverse ? nodeAsParent.children.length : -1) + step;
          grandparents = parents.concat(nodeAsParent);
          while (offset > -1 && offset < nodeAsParent.children.length) {
            const child = nodeAsParent.children[offset];
            subresult = factory(child, offset, grandparents)();
            if (subresult[0] === EXIT) {
              return subresult;
            }
            offset = typeof subresult[1] === "number" ? subresult[1] : offset + step;
          }
        }
      }
      return result;
    }
  }
}
function toResult(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "number") {
    return [CONTINUE, value];
  }
  return value === null || value === void 0 ? empty : [value];
}

// ../../../node_modules/.pnpm/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.js
function visit(tree, testOrVisitor, visitorOrReverse, maybeReverse) {
  let reverse;
  let test;
  let visitor;
  if (typeof testOrVisitor === "function" && typeof visitorOrReverse !== "function") {
    test = void 0;
    visitor = testOrVisitor;
    reverse = visitorOrReverse;
  } else {
    test = testOrVisitor;
    visitor = visitorOrReverse;
    reverse = maybeReverse;
  }
  visitParents(tree, test, overload, reverse);
  function overload(node, parents) {
    const parent = parents[parents.length - 1];
    const index = parent ? parent.children.indexOf(node) : void 0;
    return visitor(node, index, parent);
  }
}

// src/plugins/publicationDate.ts
var skippedSlugPrefixes = ["tags/", "apps/", "settings"];
function hasAuthorDate(frontmatter) {
  return frontmatter.date !== void 0 || frontmatter.published !== void 0 || frontmatter.created !== void 0;
}
function dateParagraph(date, label) {
  const time = {
    type: "element",
    tagName: "time",
    properties: { datetime: date.toISOString() },
    children: [{ type: "text", value: formatDate(date, "en-US") }]
  };
  return {
    type: "element",
    tagName: "p",
    properties: { className: ["content-meta"] },
    children: label ? [{ type: "text", value: `${label}: ` }, time] : [time]
  };
}
var PublicationDate = () => {
  return {
    name: "brinedew-publication-date",
    htmlPlugins() {
      return [
        () => (tree, file) => {
          const data = file.data;
          const slug2 = String(data.slug ?? "");
          const frontmatter = data.frontmatter ?? {};
          const label = typeof frontmatter.dateLabel === "string" ? frontmatter.dateLabel.trim() : "";
          if (!hasAuthorDate(frontmatter) || slug2 === "index" || !label && skippedSlugPrefixes.some((prefix) => slug2.startsWith(prefix))) {
            return;
          }
          let date;
          try {
            date = getDate(data);
          } catch {
            return;
          }
          if (!date) return;
          let inserted = false;
          visit(tree, "element", (node, index, parent) => {
            if (inserted || node.tagName !== "h1" || index === void 0 || !parent) return;
            parent.children.splice(index + 1, 0, dateParagraph(date, label));
            inserted = true;
          });
          if (!inserted) {
            tree.children.unshift(dateParagraph(date, label));
          }
        }
      ];
    }
  };
};

// src/plugins/imageCaptions.ts
function isElement(node) {
  return !!node && node.type === "element";
}
function isWhitespaceText(node) {
  return !!node && node.type === "text" && !node.value.trim();
}
function imageInside(node) {
  if (!isElement(node)) return void 0;
  if (node.tagName === "img") return node;
  if (node.tagName !== "a") return void 0;
  const meaningful = node.children.filter((child2) => !isWhitespaceText(child2));
  if (meaningful.length !== 1) return void 0;
  const child = meaningful[0];
  return isElement(child) && child.tagName === "img" ? child : void 0;
}
function trimmedPhrasing(nodes) {
  const next = [...nodes];
  const first = next[0];
  const last = next[next.length - 1];
  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");
  return next.filter((node) => !isWhitespaceText(node));
}
function captionFor(img) {
  const properties = img.properties;
  let alt = typeof properties.alt === "string" ? properties.alt.trim() : "";
  const width = String(properties.width ?? "");
  const height = String(properties.height ?? "");
  if (alt.endsWith(",") && /^(?:18|19|20)\d{2}$/.test(width) && (!height || height === "auto")) {
    alt = `${alt} ${width}`;
    delete properties.width;
  }
  if (properties.width === "auto") delete properties.width;
  if (properties.height === "auto") delete properties.height;
  return alt;
}
function figureFor(media, img) {
  const caption = captionFor(img);
  const children = [media];
  if (caption) {
    img.properties.alt = "";
    children.push({
      type: "element",
      tagName: "figcaption",
      properties: {},
      children: [{ type: "text", value: caption }]
    });
  }
  return {
    type: "element",
    tagName: "figure",
    properties: { className: [caption ? "image-with-caption" : "image-without-caption"] },
    children
  };
}
function splitImageParagraph(paragraph) {
  if (!paragraph.children.some((child) => imageInside(child))) return void 0;
  const replacement = [];
  let phrasing = [];
  const flushPhrasing = () => {
    const children = trimmedPhrasing(phrasing);
    phrasing = [];
    if (children.length === 0) return;
    replacement.push({
      type: "element",
      tagName: "p",
      properties: { ...paragraph.properties },
      children
    });
  };
  for (const child of paragraph.children) {
    const img = imageInside(child);
    if (!img) {
      phrasing.push(child);
      continue;
    }
    flushPhrasing();
    replacement.push(figureFor(child, img));
  }
  flushPhrasing();
  return replacement;
}
function normalizeImageCaptions(parent) {
  for (let index = 0; index < parent.children.length; index++) {
    const node = parent.children[index];
    if (!isElement(node)) continue;
    if (node.tagName === "figure") continue;
    if (node.tagName === "p") {
      const replacement = splitImageParagraph(node);
      if (replacement) {
        parent.children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
        continue;
      }
    }
    normalizeImageCaptions(node);
  }
}
var ImageCaptions = () => {
  return {
    name: "brinedew-image-captions",
    htmlPlugins() {
      return [
        () => (tree) => {
          normalizeImageCaptions(tree);
        }
      ];
    }
  };
};

// src/plugins/pinterestEmbeds.ts
var PIN_LINK = /^https?:\/\/(?:(?:[a-z]{2,3}\.|www\.)?pinterest\.[a-z.]+\/pin\/[^\s]+|pin\.it\/[A-Za-z0-9]+\/?)$/i;
var EMBED_ID = /assets\.pinterest\.com\/ext\/embed\.html\?id=(\d+)/;
function isElement2(node) {
  return !!node && node.type === "element";
}
function barePinLink(node) {
  if (!isElement2(node) || node.tagName !== "a") return void 0;
  const href = String(node.properties.href ?? "");
  const text = node.children.map((child) => child.type === "text" ? child.value : "").join("");
  return text.trim() === href && PIN_LINK.test(href) ? href : void 0;
}
function lonePinLinks(node) {
  const lines = node.children.filter(
    (child) => !(child.type === "text" && !child.value.trim()) && !(isElement2(child) && child.tagName === "br")
  );
  const urls = lines.map(barePinLink);
  if (urls.length === 0 || urls.some((url) => !url)) return void 0;
  return urls;
}
var frames = /* @__PURE__ */ new Map();
function pinFrame(url) {
  let frame = frames.get(url);
  if (!frame) {
    frame = (async () => {
      try {
        const response = await fetch(
          `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(1e4) }
        );
        if (!response.ok) return void 0;
        const body = await response.json();
        const id = EMBED_ID.exec(body.html ?? "")?.[1];
        if (!id) return void 0;
        return { id, width: body.width ?? 450, height: body.height ?? 600 };
      } catch {
        return void 0;
      }
    })();
    frames.set(url, frame);
  }
  return frame;
}
function iframeFor(frame) {
  return {
    type: "element",
    tagName: "iframe",
    properties: {
      src: `https://assets.pinterest.com/ext/embed.html?id=${frame.id}`,
      width: frame.width,
      height: frame.height,
      frameBorder: "0",
      scrolling: "no",
      loading: "lazy",
      title: "Pinterest pin",
      className: ["pinterest-embed"]
    },
    children: []
  };
}
async function embedPins(parent) {
  for (const node of parent.children) {
    if (!isElement2(node)) continue;
    const urls = node.tagName === "p" || node.tagName === "li" ? lonePinLinks(node) : void 0;
    if (!urls) {
      await embedPins(node);
      continue;
    }
    const pinFrames = await Promise.all(urls.map(pinFrame));
    node.children = node.children.map((child) => {
      const index = urls.indexOf(barePinLink(child) ?? "");
      const frame = index >= 0 ? pinFrames[index] : void 0;
      return frame ? iframeFor(frame) : child;
    });
  }
}
var PinterestEmbeds = () => {
  return {
    name: "brinedew-pinterest-embeds",
    htmlPlugins() {
      return [() => async (tree) => embedPins(tree)];
    }
  };
};

// src/plugins/draftTagInjector.ts
var rehypeDraftTag = () => {
  return (_tree, file) => {
    const frontmatter = file.data.frontmatter;
    if (!frontmatter) return;
    const isDraft = frontmatter.draft === true || frontmatter.draft === "true";
    if (!isDraft) return;
    const tags = frontmatter.tags ?? [];
    if (!tags.includes("draft")) {
      frontmatter.tags = [...tags, "draft"];
    }
  };
};
var DraftTagInjector = () => ({
  name: "brinedew-draft-tag-injector",
  htmlPlugins() {
    return [rehypeDraftTag];
  }
});

// src/plugins/essayNormalizer.ts
var isElement3 = (node) => !!node && node.type === "element";
var isWhitespaceText2 = (node) => !!node && node.type === "text" && !node.value.trim();
var isBreak = (node) => isElement3(node) && node.tagName === "br";
var PHRASING_OK = /* @__PURE__ */ new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "del",
  "em",
  "i",
  "img",
  "kbd",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var"
]);
function isPhrasingOnly(nodes) {
  return nodes.every((child) => {
    if (child.type === "text") return true;
    if (child.type !== "element") return false;
    if (!PHRASING_OK.has(child.tagName)) return false;
    return isPhrasingOnly(child.children);
  });
}
function stripBreaks(children) {
  const next = [];
  for (let i2 = 0; i2 < children.length; i2++) {
    const child = children[i2];
    if (!isBreak(child)) {
      next.push(child);
      continue;
    }
    const prev = next[next.length - 1];
    const following = children[i2 + 1];
    if (isElement3(prev) || isElement3(following)) continue;
    if (isWhitespaceText2(prev) || isWhitespaceText2(following)) continue;
    const prevAsUnknown = prev;
    if (prevAsUnknown && typeof prevAsUnknown === "object" && prevAsUnknown.type === "text") {
      const textNode = prevAsUnknown;
      if (!textNode.value.endsWith(" ")) textNode.value += " ";
    } else {
      next.push({ type: "text", value: " " });
    }
  }
  return next;
}
function normalizeStructure(tree) {
  visit(
    tree,
    "element",
    (node, index, parent) => {
      if (!parent || index === void 0) return;
      if (node.tagName === "pre" || node.tagName === "code") return;
      if (node.tagName === "p") {
        const meaningful = node.children.filter((child) => {
          if (child.type === "text") return child.value.trim().length > 0;
          if (isBreak(child)) return false;
          return true;
        });
        if (meaningful.length === 0) {
          parent.children.splice(index, 1);
          return;
        }
        node.children = stripBreaks(meaningful);
        const paragraphs = parent.children.filter(
          (child) => isElement3(child) && child.tagName === "p"
        );
        if (parent.type === "element" && parent.tagName === "li" && paragraphs.length === 1 && isPhrasingOnly(node.children)) {
          parent.children.splice(index, 1, ...node.children);
          return;
        }
      }
      if (node.children.some(isBreak)) {
        node.children = stripBreaks(node.children);
      }
      if (isElement3(node) && (node.tagName === "ul" || node.tagName === "ol" || node.tagName === "li" || node.tagName === "blockquote")) {
        node.children = node.children.filter((child) => !isWhitespaceText2(child));
      }
    }
  );
}
function normalizeHeadings(tree) {
  let sawTitle = false;
  visit(tree, "element", (node) => {
    const match = /^h([1-6])$/.exec(node.tagName);
    if (!match) return;
    const level = Number(match[1]);
    if (!sawTitle) {
      sawTitle = true;
      node.tagName = "h1";
      return;
    }
    if (level <= 1) {
      node.tagName = "h2";
      return;
    }
    node.tagName = `h${Math.min(6, level)}`;
  });
}
var EssayNormalizer = () => {
  return {
    name: "brinedew-essay-normalizer",
    htmlPlugins() {
      return [
        () => (tree) => {
          normalizeStructure(tree);
          normalizeHeadings(tree);
        }
      ];
    }
  };
};
export {
  ContactForm_default as ContactForm,
  DraftTagInjector,
  EssayNormalizer,
  HomepageCrawlFrontier_default as HomepageCrawlFrontier,
  IconoplasmPageSwitcher_default as IconoplasmPageSwitcher,
  ImageCaptions,
  PinterestEmbeds,
  ProteinInfobox_default as ProteinInfobox,
  PublicationDate,
  TagSections_default as TagSections
};
