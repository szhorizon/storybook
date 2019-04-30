const mdxToJsx = require('@mdx-js/mdx/mdx-hast-to-jsx');
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const camelCase = require('lodash.camelcase');

// Generate the MDX as is, but append named exports for every
// story in the contents

const STORY_REGEX = /^<Story /;
const RESERVED = /^(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|await|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/;

function getAttr(elt, what) {
  const attr = elt.attributes.find(n => n.name.name === what);
  return attr && attr.value.value;
}

function getStoryFn(name, counter) {
  if (name) {
    const storyFn = camelCase(name.replace(/[^a-z0-9-]/g, '-'));
    if (storyFn.length > 1 && !RESERVED.exec(storyFn)) {
      return storyFn;
    }
  }
  return `story${counter}`;
}

function getStory(node, counter) {
  if (node.type !== 'jsx' || !STORY_REGEX.exec(node.value)) {
    return null;
  }

  const ast = parser.parseExpression(node.value, { plugins: ['jsx'] });
  const storyName = getAttr(ast.openingElement, 'name');

  // console.log(JSON.stringify(ast, null, 2));

  const statements = [];
  const storyFn = getStoryFn(storyName, counter);

  // FIXME: handle fragments
  let body = ast.children.find(n => n.type !== 'JSXText');
  if (body.type === 'JSXExpressionContainer') {
    body = body.expression;
  }

  const { code } = generate(body, {});
  statements.push(
    `export const ${storyFn} = () => (
      ${code}
    );`
  );

  if (storyName !== storyFn) {
    statements.push(`${storyFn}.title = '${storyName}';`);
  }

  // console.log(statements);

  return statements.join('\n');
}

// insert `mdxKind` into the context so that we can know what "kind" we're rendering into
// when we render <Story name="xxx">...</Story>, since this MDX can be attached to any `selectedKind`!
const wrappedMDXContent = `
const WrappedMDXContent = ({ context }) => (
  <DC.Provider value={{...context, mdxKind: componentMeta && (componentMeta.title || componentMeta.displayName) }}>
    <MDXContent components={((context && context.parameters && context.parameters.options && context.parameters.options.docs) || {}).mdxComponents} />
  </DC.Provider>
);
`.trim();

function extractStories(node, options) {
  // we're overriding default export
  const defaultJsx = mdxToJsx.toJSX(node, {}, { ...options, skipExport: true });
  const stories = [];
  let counter = 0;
  node.children.forEach(n => {
    const story = getStory(n, counter);
    if (story) {
      stories.push(story);
      counter += 1;
    }
  });

  const fullJsx = [
    'import { DocsContext as DC } from "@storybook/components"',
    defaultJsx,
    wrappedMDXContent,
    'export default WrappedMDXContent;',
    'componentMeta.parameters = componentMeta.parameters || {};',
    'componentMeta.parameters.docs = WrappedMDXContent',
    ...stories,
  ].join('\n\n');

  return fullJsx;
}

function createCompiler(mdxOptions) {
  return function compiler(options = {}) {
    this.Compiler = tree => extractStories(tree, options, mdxOptions);
  };
}

module.exports = createCompiler;
