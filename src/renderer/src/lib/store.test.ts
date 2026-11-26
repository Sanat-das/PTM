import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_FILTERS } from '../../../shared/types.ts'
import { useUiStore } from './store.ts'

function reset() {
  useUiStore.setState({
    query: '',
    submitted: '',
    view: 'search',
    browseCategory: 'movies',
    filters: { ...DEFAULT_FILTERS }
  })
}

test('submitting a search from Browse switches to Search and drops the browse theme', () => {
  reset()
  useUiStore.getState().setView('browse')
  assert.equal(useUiStore.getState().view, 'browse')
  assert.deepEqual(useUiStore.getState().filters.themes, ['movies'])

  useUiStore.getState().setQuery('some show')
  useUiStore.getState().submit()

  const state = useUiStore.getState()
  assert.equal(state.view, 'search')
  assert.equal(state.submitted, 'some show')
  assert.deepEqual(state.filters.themes, [])
})

test('submitting a search from Discover switches to Search', () => {
  reset()
  useUiStore.getState().setView('discover')

  useUiStore.getState().setQuery('a movie')
  useUiStore.getState().submit()

  assert.equal(useUiStore.getState().view, 'search')
  assert.equal(useUiStore.getState().submitted, 'a movie')
})

test('leaving Browse clears the injected theme so later searches are unfiltered', () => {
  reset()
  useUiStore.getState().setBrowseCategory('tv')
  useUiStore.getState().setView('browse')
  assert.deepEqual(useUiStore.getState().filters.themes, ['tv'])

  useUiStore.getState().setView('search')
  assert.deepEqual(useUiStore.getState().filters.themes, [])
})

test('submitting from Search keeps themes the user selected there', () => {
  reset()
  useUiStore.getState().toggleTheme('anime')
  useUiStore.getState().setQuery('anime show')
  useUiStore.getState().submit()

  assert.deepEqual(useUiStore.getState().filters.themes, ['anime'])
})
