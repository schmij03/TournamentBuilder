#!/usr/bin/env node
/*
 * Erzeugt aus index.html + CSS + JS zwei Einzeldateien in dist/:
 *  - tournamentbuilder.html: komplette Seite, z. B. für USB-Stick oder E-Mail
 *  - artifact.html: nur Kopf- und Körperinhalt (für Hosts, die das HTML-Gerüst selbst liefern)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, file) => `<style>\n${read(file)}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => {
  const code = read(file);
  if (code.includes('</script')) throw new Error(file + ' enthält </script');
  return `<script>\n${code}</script>`;
});

const between = (start, end) => {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < 0) throw new Error('Marker fehlt: ' + start);
  return html.slice(a + start.length, b).trim();
};

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'tournamentbuilder.html'), html);
fs.writeFileSync(
  path.join(root, 'dist', 'artifact.html'),
  between('<!-- head:start -->', '<!-- head:end -->') + '\n' + between('<!-- body:start -->', '<!-- body:end -->') + '\n'
);
console.log('dist/tournamentbuilder.html und dist/artifact.html erstellt.');
