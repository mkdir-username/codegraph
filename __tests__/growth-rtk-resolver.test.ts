import { describe, it, expect } from 'vitest';
import { reduxToolkitResolver } from '../src/resolution/frameworks/redux-toolkit';
import { getFrameworkResolver } from '../src/resolution/frameworks';

const SLICE_SRC = `
import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';

export const fetchProperties = createAsyncThunk('ui/fetch', async () => {});

const propertiesSlice = createSlice({
  name: 'properties',
  initialState: {},
  reducers: {
    setUIResolution(state, action) { state.resolution = action.payload; },
    setUIPlatform: (state, action) => { state.platform = action.payload; },
    setUIBackground(state, action) { state.background = action.payload; },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchProperties.fulfilled, (state, action) => {
      state.loaded = true;
    });
  },
});

export const { setUIResolution, setUIPlatform, setUIBackground } = propertiesSlice.actions;

export const propertiesSelector = createSelector(
  (state) => state.properties,
  (properties) => properties,
);
`;

describe('reduxToolkitResolver.extract — reducer member nodes (item #8a)', () => {
  it('emits a function node for each createSlice reducers member, qualified Slice.reducers.key', () => {
    const { nodes } = reduxToolkitResolver.extract!('src/store/propertiesSlice.ts', SLICE_SRC);
    const reducerNodes = nodes.filter((n) => n.kind === 'function');
    const names = reducerNodes.map((n) => n.name).sort();
    expect(names).toEqual(['setUIBackground', 'setUIPlatform', 'setUIResolution']);

    const qualified = reducerNodes.map((n) => n.qualifiedName).sort();
    expect(qualified).toEqual([
      'propertiesSlice.reducers.setUIBackground',
      'propertiesSlice.reducers.setUIPlatform',
      'propertiesSlice.reducers.setUIResolution',
    ]);
  });
});

describe('reduxToolkitResolver.extract — action→reducer reference (item #8b)', () => {
  it('emits a references edge from each destructured action to its reducer member node', () => {
    const { nodes, references } = reduxToolkitResolver.extract!('src/store/propertiesSlice.ts', SLICE_SRC);
    const reducerNode = nodes.find((n) => n.name === 'setUIResolution');
    expect(reducerNode).toBeTruthy();

    // a reference must target the reducer member node for the destructured action
    const ref = references.find(
      (r) => r.referenceKind === 'references' && r.candidates?.includes(reducerNode!.qualifiedName),
    );
    expect(ref).toBeTruthy();
  });
});

describe('reduxToolkitResolver is registered (item #8)', () => {
  it('is reachable via getFrameworkResolver("redux-toolkit")', () => {
    expect(getFrameworkResolver('redux-toolkit')).toBe(reduxToolkitResolver);
  });
});
