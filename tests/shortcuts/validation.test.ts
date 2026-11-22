import { describe, expect, it } from 'vitest'
import { isExecutablePath } from '../../src/main/core/shortcuts/executable'
import { MAX_LABEL_LENGTH, MAX_URL_LENGTH } from '../../src/shared/shortcuts/types'
import { isPlausiblePath, parseShortcutLabel, parseShortcutUrl } from '../../src/shared/validation/shortcut'
import {
  parseAddUrlInput,
  parseLabel,
  parseMoveDirection,
  parsePathKind
} from '../../src/shared/validation/shortcutIpc'

describe('parseShortcutUrl', () => {
  it('accepts http and https addresses and returns the normalized address', () => {
    expect(parseShortcutUrl('https://example.com')).toBe('https://example.com/')
    expect(parseShortcutUrl('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c')
    expect(parseShortcutUrl('  https://example.com/path  ')).toBe('https://example.com/path')
    expect(parseShortcutUrl('HTTPS://Example.COM/X')).toBe('https://example.com/X')
    expect(parseShortcutUrl('https://example.com:8443/app')).toBe('https://example.com:8443/app')
    expect(parseShortcutUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(parseShortcutUrl('https://한글.example/경로')).toContain('xn--')
  })

  it('refuses every other scheme (javascript:, file:, data:, ...)', () => {
    const bad = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'file://C:/Windows/System32/calc.exe',
      'ftp://example.com/file',
      'mailto:someone@example.com',
      'tel:+8200000000',
      'ms-msdt:/id',
      'chrome://settings',
      'about:blank',
      'blob:https://example.com/id',
      'ws://example.com',
      'steam://run/1'
    ]
    for (const value of bad) expect(parseShortcutUrl(value), value).toBeNull()
  })

  it('refuses things that are not complete http(s) addresses', () => {
    for (const value of ['example.com', '//example.com', 'https://', 'http://', '', '   ', 'not a url', '/local/path', 'C:/Users/x/file.txt']) {
      expect(parseShortcutUrl(value), value).toBeNull()
    }
  })

  it('follows the URL standard for extra slashes (the same thing a browser would open)', () => {
    expect(parseShortcutUrl('https:///path')).toBe('https://path/')
  })

  it('refuses an address with a user name or password in it', () => {
    expect(parseShortcutUrl('https://user:secret@example.com')).toBeNull()
    expect(parseShortcutUrl('https://trusted.example.com@evil.example')).toBeNull()
  })

  it('refuses non-strings and addresses that are too long', () => {
    for (const value of [null, undefined, 5, {}, ['https://example.com']]) expect(parseShortcutUrl(value)).toBeNull()
    const longPath = 'a'.repeat(MAX_URL_LENGTH)
    expect(parseShortcutUrl(`https://example.com/${longPath}`)).toBeNull()
    expect(parseShortcutUrl(`https://example.com/${'a'.repeat(100)}`)).not.toBeNull()
  })
})

describe('parseShortcutLabel', () => {
  it('trims and needs 1-100 characters', () => {
    expect(parseShortcutLabel('  메일  ')).toBe('메일')
    expect(parseShortcutLabel('x'.repeat(MAX_LABEL_LENGTH))).toHaveLength(MAX_LABEL_LENGTH)
    for (const value of ['', '   ', 'x'.repeat(MAX_LABEL_LENGTH + 1), 5, null, undefined]) {
      expect(parseShortcutLabel(value)).toBeNull()
    }
  })
})

describe('isPlausiblePath', () => {
  it('needs a non-empty string without NUL characters, of sane length', () => {
    expect(isPlausiblePath('/home/user/file.txt')).toBe(true)
    expect(isPlausiblePath('')).toBe(false)
    expect(isPlausiblePath('/a\u0000b')).toBe(false)
    expect(isPlausiblePath('x'.repeat(5000))).toBe(false)
    expect(isPlausiblePath(5)).toBe(false)
    expect(isPlausiblePath(null)).toBe(false)
  })
})

describe('shortcut IPC input', () => {
  it('addUrl takes only url and an optional label', () => {
    expect(parseAddUrlInput({ url: 'https://example.com' })).toEqual({ ok: true, value: { url: 'https://example.com' } })
    expect(parseAddUrlInput({ url: 'https://example.com', label: '예시' }).ok).toBe(true)
    expect(parseAddUrlInput({ label: 'x' })).toEqual({ ok: false, field: 'url' })
    expect(parseAddUrlInput({ url: 5 })).toEqual({ ok: false, field: 'url' })
    expect(parseAddUrlInput({ url: 'https://example.com', label: 5 })).toEqual({ ok: false, field: 'label' })
    for (const value of [null, 'x', 5, [], undefined]) expect(parseAddUrlInput(value)).toEqual({ ok: false, field: 'input' })
  })

  it('addUrl refuses a path field: the renderer cannot send a path', () => {
    expect(parseAddUrlInput({ url: 'https://example.com', path: '/etc/passwd' })).toEqual({ ok: false, field: 'input' })
    expect(parseAddUrlInput({ url: 'https://example.com', target: 'C:/x.exe' })).toEqual({ ok: false, field: 'input' })
    expect(parseAddUrlInput({ url: 'https://example.com', kind: 'path' })).toEqual({ ok: false, field: 'input' })
  })

  it('pickPath kind, move direction and label', () => {
    expect(parsePathKind('file')).toEqual({ ok: true, value: 'file' })
    expect(parsePathKind('folder')).toEqual({ ok: true, value: 'folder' })
    for (const value of ['url', 'path', '', '/etc', null, undefined, 5]) expect(parsePathKind(value)).toEqual({ ok: false, field: 'kind' })

    expect(parseMoveDirection('up')).toEqual({ ok: true, value: 'up' })
    expect(parseMoveDirection('down')).toEqual({ ok: true, value: 'down' })
    for (const value of ['left', '', null, 1]) expect(parseMoveDirection(value)).toEqual({ ok: false, field: 'direction' })

    expect(parseLabel('이름')).toEqual({ ok: true, value: '이름' })
    expect(parseLabel(5)).toEqual({ ok: false, field: 'label' })
  })
})

describe('isExecutablePath', () => {
  it('recognizes programs and scripts on every platform, ignoring case', () => {
    for (const name of ['setup.exe', 'SETUP.EXE', 'run.bat', 'go.cmd', 'link.lnk', 'x.ps1', 'x.vbs', 'x.js', 'x.msi', 'x.jar', 'x.hta', 'Tool.app', 'x.command', 'x.pkg', 'x.dmg', 'run.sh', 'x.AppImage', 'x.desktop']) {
      expect(isExecutablePath(`/some/dir/${name}`), name).toBe(true)
    }
  })

  it('works with Windows separators and a trailing slash on app bundles', () => {
    expect(isExecutablePath('C:/Users/me/Downloads/setup.exe')).toBe(true)
    expect(isExecutablePath('/Applications/Tool.app/')).toBe(true)
  })

  it('does not flag documents, images, folders and links to files without extension', () => {
    for (const path of ['/d/report.pdf', '/d/notes.txt', '/d/pic.png', '/d/sheet.xlsx', '/d/archive.zip', '/d/folder', '/d/README', '/d/exe', '/d/my.exe.txt', '/d/.hidden']) {
      expect(isExecutablePath(path), path).toBe(false)
    }
  })
})
