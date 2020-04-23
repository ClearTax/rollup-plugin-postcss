import path from 'path'
import fs from 'fs-extra'
import { rollup } from 'rollup'
import postcss from '../src'

process.env.ROLLUP_POSTCSS_TEST = true
/**
 * solve jest timeout on Windows OS
 */
const JEST_TIMEOUT = process.platform === 'win32' ? 20000 : 5000

function fixture(...args) {
  if (args.length === 1 && typeof args[0] === 'object') {
    const fixtureInput = {}
    for (const [key, value] of Object.entries(args[0])) {
      fixtureInput[key] = path.join(__dirname, 'fixtures', value)
    }

    return fixtureInput
  }

  return path.join(__dirname, 'fixtures', ...args)
}

beforeAll(() => fs.remove(fixture('dist')))

async function write({
  input,
  outDir,
  options
}) {
  const isMultiEntry = typeof input === 'object'
  outDir = fixture('dist', outDir)
  const bundle = await rollup({
    input: fixture(input),
    plugins: [
      postcss(options)
    ]
  })
  await bundle.write({
    format: 'cjs',
    ...(
      isMultiEntry ?
        { dir: outDir } :
        { file: path.join(outDir, 'bundle.js') }
    )
  })
  let cssCodePath = path.join(outDir, 'bundle.css')
  if (typeof options.extract === 'string') {
    if (path.isAbsolute(options.extract)) {
      cssCodePath = options.extract
    } else {
      cssCodePath = path.join(outDir, options.extract)
    }
  }

  const cssMapPath = `${cssCodePath}.map`
  const jsCodePath = path.join(outDir, 'bundle.js')
  const entryNames = Object.keys(input)

  return {
    async jsCode() {
      if (!isMultiEntry) {
        return fs.readFile(jsCodePath, 'utf8')
      }

      return Promise.all(
        entryNames.map(async entry => [
          entry,
          await fs.readFile(path.join(outDir, `${entry}.js`), 'utf8')
        ])
      )
    },
    async cssCode() {
      if (!isMultiEntry) {
        return fs.readFile(cssCodePath, 'utf8')
      }

      return Promise.all(
        entryNames.map(async entry => [
          entry,
          await fs.readFile(path.join(outDir, `${entry}.css`), 'utf8')
        ])
      )
    },
    cssMap() {
      return fs.readFile(cssMapPath, 'utf8')
    },
    async hasCssFile() {
      if (!isMultiEntry) {
        return fs.pathExists(cssCodePath)
      }

      const results = await Promise.all(
        entryNames.map(entry => fs.pathExists(path.join(outDir, `${entry}.css`)))
      )
      return results.every(Boolean)
    },
    hasCssMapFile() {
      if (!isMultiEntry) {
        return fs.pathExists(cssMapPath)
      }
    }
  }
}

function snapshot({
  title,
  input,
  outDir,
  options = {}
}) {
  test(title, async () => {
    let result
    const isMultiEntry = typeof input === 'object'
    try {
      result = await write({
        input,
        outDir,
        options
      })
    } catch (error) {
      const frame = error.codeFrame || error.snippet
      if (frame) {
        throw new Error(frame + error.message)
      }

      throw error
    }

    if (isMultiEntry) {
      const files = await result.jsCode()
      for (const [entry, file] of files) {
        expect(file).toMatchSnapshot(`js code ${entry}`)
      }
    } else {
      expect(await result.jsCode()).toMatchSnapshot('js code')
    }

    if (options.extract) {
      expect(await result.hasCssFile()).toBe(true)
      if (isMultiEntry) {
        const files = await result.cssCode()
        for (const [entry, file] of files) {
          expect(file).toMatchSnapshot(`css code ${entry}`)
        }
      } else {
        expect(await result.cssCode()).toMatchSnapshot('css code')
      }
    }

    const sourceMap = options && options.sourceMap
    if (sourceMap === 'inline') {
      expect(await result.hasCssMapFile()).toBe(false)
    } else if (sourceMap === true) {
      expect(await result.hasCssMapFile()).toBe(Boolean(options.extract))
      if (options.extract) {
        expect(await result.cssMap()).toMatchSnapshot('css map')
      }
    }
  }, JEST_TIMEOUT)
}

function snapshotMany(title, tests) {
  describe(title, () => {
    for (const test of tests) {
      snapshot({
        ...test,
        outDir: `${title}--${test.title}`
      })
    }
  })
}

snapshotMany('basic', [
  {
    title: 'simple',
    input: 'simple/index.js'
  },
  {
    title: 'postcss-config',
    input: 'postcss-config/index.js'
  },
  {
    title: 'skip-loader',
    input: 'skip-loader/index.js',
    options: {
      use: ['loader'],
      loaders: [
        {
          name: 'loader',
          test: /\.random$/,
          process() {
            return 'lol'
          }
        }
      ]
    }
  },
  {
    title: 'postcss-options',
    input: 'postcss-options/index.js',
    options: {
      plugins: [
        require('autoprefixer')()
      ]
    }
  }
])

snapshotMany('minimize', [
  {
    title: 'inject',
    input: 'simple/index.js',
    options: {
      minimize: true
    }
  },
  {
    title: 'extract',
    input: 'simple/index.js',
    options: {
      minimize: true,
      extract: true
    }
  },
  {
    title: 'extract-sourcemap-true',
    input: 'simple/index.js',
    options: {
      minimize: true,
      extract: true,
      sourceMap: true
    }
  },
  {
    title: 'extract-sourcemap-inline',
    input: 'simple/index.js',
    options: {
      minimize: true,
      extract: true,
      sourceMap: 'inline'
    }
  }
])

snapshotMany('modules', [
  {
    title: 'inject',
    input: 'css-modules/index.js',
    options: {
      modules: true
    }
  },
  {
    title: 'inject-object',
    input: 'css-modules/index.js',
    options: {
      modules: {
        getJSON() {
          //
        }
      }
    }
  },
  {
    title: 'named-exports',
    input: 'named-exports/index.js',
    options: {
      modules: true,
      namedExports: true
    }
  },
  {
    title: 'named-exports-custom-class-name',
    input: 'named-exports/index.js',
    options: {
      modules: true,
      namedExports(name) {
        return name + 'hacked'
      }
    }
  },
  {
    title: 'extract',
    input: 'css-modules/index.js',
    options: {
      modules: true,
      extract: true
    }
  },
  {
    title: 'auto-modules',
    input: 'auto-modules/index.js'
  }
])

snapshotMany('sourcemap', [
  {
    title: 'true',
    input: 'simple/index.js',
    options: {
      sourceMap: true
    }
  },
  // Is it broken?
  {
    title: 'inline',
    input: 'simple/index.js',
    options: {
      sourceMap: 'inline'
    }
  }
])

snapshotMany('extract', [
  {
    title: 'true',
    input: 'simple/index.js',
    options: {
      extract: true
    }
  },
  {
    title: 'custom-path',
    input: 'simple/index.js',
    options: {
      extract: fixture('dist/extract--custom-path/this/is/extracted.css'),
      sourceMap: true
    }
  },
  {
    title: 'relative-path',
    input: 'simple/index.js',
    options: {
      extract: 'this/is/extracted.css',
      sourceMap: true
    }
  },
  {
    title: 'sourcemap-true',
    input: 'simple/index.js',
    options: {
      sourceMap: true,
      extract: true
    }
  },
  {
    title: 'sourcemap-inline',
    input: 'simple/index.js',
    options: {
      sourceMap: 'inline',
      extract: true
    }
  }
])

snapshotMany('inject', [
  {
    title: 'top',
    input: 'simple/index.js',
    options: {
      inject: {
        insertAt: 'top'
      }
    }
  },
  {
    title: 'function',
    input: 'simple/index.js',
    options: {
      inject: variableName => `console.log(${variableName})`
    }
  },
  {
    title: 'false',
    input: 'simple/index.js',
    options: {
      inject: false
    }
  }
])

snapshotMany('sass', [
  {
    title: 'default',
    input: 'sass/index.js'
  },
  {
    title: 'sourcemap',
    input: 'sass/index.js',
    options: {
      sourceMap: true
    }
  },
  {
    title: 'modules',
    input: 'sass-modules/index.js',
    options: {
      modules: true
    }
  },
  {
    title: 'data-prepend',
    input: 'sass-data-prepend/index.js',
    options: {
      use: [
        [
          'sass',
          { data: '@import \'prepend\';' }
        ]
      ]
    }
  },
  {
    title: 'data-prepend',
    input: 'sass-data-prepend/index.js',
    options: {
      use: {
        sass: { data: '@import \'prepend\';' }
      }
    }
  },
  {
    title: 'import',
    input: 'sass-import/index.js'
  }
])

snapshotMany('multi-entry', [
  {
    title: 'multi-entry',
    input: {
      entry1: 'multi-entry/entry1.js',
      entry2: 'multi-entry/entry2.js'
    },
    options: {
      extract: true,
      multiEntry: true
    }
  }
])

test('onExtract', async () => {
  const result = await write({
    input: 'simple/index.js',
    outDir: 'onExtract',
    options: {
      extract: true,
      onExtract() {
        return false
      }
    }
  })
  expect(await result.jsCode()).toMatchSnapshot()
  expect(await result.hasCssFile()).toBe(false)
})

test('augmentChunkHash', async () => {
  const outDir = fixture('dist', 'augmentChunkHash')
  const cssFiles = ['simple/foo.css', 'simple/foo.css', 'simple/bar.css']

  const outputFiles = []
  /* eslint-disable no-await-in-loop */
  for (const file of cssFiles) {
    const newBundle = await rollup({
      input: fixture(file),
      plugins: [postcss({ extract: true })]
    })
    const entryFileName = file.split('.')[0]
    const { output } = await newBundle.write({
      dir: outDir,
      entryFileNames: `${entryFileName}.[hash].css`
    })
    outputFiles.push(output[0])
  }

  const [fooOne, fooTwo, barOne] = outputFiles

  const fooHash = fooOne.fileName.split('.')[1]
  expect(fooHash).toBeTruthy() // Verify that [hash] part of `foo.[hash].css` is truthy
  expect(fooOne.fileName).toEqual(fooTwo.fileName) // Verify that the foo hashes to the same fileName

  const barHash = barOne.fileName.split('.')[1]
  expect(barHash).not.toEqual(fooHash) // Verify that foo and bar does not hash to the same
})
