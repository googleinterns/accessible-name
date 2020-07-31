import {CDPSession, Page} from 'puppeteer';
import * as puppeteer from 'puppeteer';
import {Protocol} from 'devtools-protocol';
import fetch from 'node-fetch';
import {
  NodeRef,
  getNodeRefFromSelector,
  getNodeRefFromBackendId,
} from './node_ref';

// TODO: import node package when our lib is ready,
// export .source as is done in axe.
import {ourLibSource} from './our_lib_source';
import * as axe from 'axe-core';

// TODO: Take user input from UI rather than hard coded
const INPUT_HTML = `
  <html>
    <head>
      <title>
        A Sample HTML Document
      </title>
    </head>
    <body>
      <div id="baz">3</div>
      <div accnameComparisonTarget aria-labelledby="foo bar baz"></div>
      <div id="bar">2</div>
      <div id="foo">1</div>
    </body>
  </html>
`;

(async () => {
  const browser = await puppeteer.launch({
    args: ['--enable-blink-features=AccessibilityObjectModel'],
  });
  const page = await browser.newPage();
  await page.goto('data:text/html,' + INPUT_HTML);
  const client = await page.target().createCDPSession();

  await loadAccNameLibraries(page);
  const targetNodeRef = await getNodeRefFromSelector(
    '[accnameComparisonTarget]',
    client,
    page
  );
  if (targetNodeRef) {
    const accnames = await runComparison(targetNodeRef, page, client);
    console.log('AccName comparison:\n', accnames);

    const htmlUsedByChrome = await getHTMLUsedByChrome(
      targetNodeRef,
      client,
      page
    );
    console.log('\nHTML used by Chrome:\n', htmlUsedByChrome);
  }

  await browser.close();
})();

/**
 * Run a series of AccName implementations on the same node.
 * @param nodeRef - NodeRef representing the target node for comparison.
 * @param page - Page in which to run the implementations.
 * @return - A mapping from implementation name to the accessible name produced
 * by that implementation.
 */
async function runComparison(
  nodeRef: NodeRef,
  page: Page,
  client: CDPSession
): Promise<{[key: string]: string}> {
  const accnames: {[key: string]: string} = {};

  // Chrome accname
  const getPartialAXTreeResponse = (await client.send(
    'Accessibility.getPartialAXTree',
    {
      backendNodeId: nodeRef.backendId,
      fetchRelatives: false,
    }
  )) as Protocol.Accessibility.GetPartialAXTreeResponse;
  const axNode = getPartialAXTreeResponse.nodes[0];
  accnames.chrome = axNode.name?.value ?? '';

  // Axe accname
  const axeName = (await page.evaluate(
    `axeTargetElem = axe.utils.querySelectorAll(_tree, '${nodeRef.selector}')[0];
    axe.commons.text.accessibleTextVirtual(axeTargetElem);`
  )) as string;
  accnames.axe = axeName;

  // AOM accname
  const aomName = (await page.evaluate(
    `getAOMName('${nodeRef.selector}');`
  )) as string;
  accnames.aom = aomName;

  // BG prototype accname
  const bgName = (await page.evaluate(
    `getAccName(document.querySelector('${nodeRef.selector}')).name`
  )) as string;
  accnames.bg = bgName;

  // Our accname
  const ourName = (await page.evaluate(
    `OurLib.getAccessibleName(document.querySelector('${nodeRef.selector}'));`
  )) as string;
  accnames.ourLib = ourName;

  return accnames;
}

/**
 * Prepare AccName implementation libraries to be run on the current page.
 * @param page - The page in which the libraries
 */
async function loadAccNameLibraries(page: Page) {
  // Load axe-core
  await page.evaluate(axe.source);
  await page.evaluate(
    'const _tree = axe.utils.getFlattenedTree(document.body);'
  );
  await page.evaluate('let axeTargetElem');

  // Load aom wrapper function
  page.evaluate(`
    const getAOMName = async (selector) => {
      const aomObj = await getComputedAccessibleNode(document.querySelector(selector));
      return aomObj.name;
    }
  `);

  // Load Bryan Garaventa's Prototype from github repo
  const bgPrototypeSource = await (async () => {
    const response = await fetch(
      'https://whatsock.github.io/w3c-alternative-text-computation/Sample%20JavaScript%20Recursion%20Algorithm/recursion.js'
    );
    const responseBody = await response.text();
    return responseBody;
  })();
  await page.evaluate(bgPrototypeSource);

  // Load our AccName
  await page.evaluate(ourLibSource);
}

/**
 * Get a string containing the HTML used by Chrome DevTools to compute the accessible name
 * for nodeRef.
 * @param nodeRef - The node whose accessible name is being computed.
 * @param client - The CDPSession for page.
 * @param page - The page in which to run the accessible name computation.
 */
async function getHTMLUsedByChrome(
  nodeRef: NodeRef,
  client: CDPSession,
  page: Page
): Promise<string> {
  const nodesUsedByChrome = await getNodesUsedByChrome(nodeRef, client, page);
  // Filter any nodes whose HTML would be part of the outerHTML of another node in 'nodesUsedByChrome'.
  const relevantNodes = await nodesUsedByChrome.filter(
    async first =>
      await !nodesUsedByChrome.some(
        async second =>
          (await nodeRefContains(second, first, page)) && second !== first
      )
  );
  let htmlString = '';
  for (const nodeRef of relevantNodes) {
    htmlString +=
      (await page.evaluate(node => node.outerHTML, nodeRef.handle)) + '\n';
  }
  return htmlString;
}

async function nodeRefContains(
  first: NodeRef,
  second: NodeRef,
  page: Page
): Promise<boolean> {
  return await page.evaluate(
    (nodeA, nodeB) => nodeA.contains(nodeB),
    first.handle,
    second.handle
  );
}

/**
 * Gets all nodes used by Chrome to compute the accessible name for nodeRef.
 * @param nodeRef - Node whose accessible name is being computed.
 * @param client - CDPSession for page.
 * @param page - Page containing nodeRef.
 */
async function getNodesUsedByChrome(
  nodeRef: NodeRef,
  client: CDPSession,
  page: Page
): Promise<NodeRef[]> {
  const stack: NodeRef[] = [];
  const nodesUsed: NodeRef[] = [];
  // Track backendIds of visited nodes to avoid infinite cycle.
  const visitedNodes: Protocol.DOM.BackendNodeId[] = [];
  stack.push(nodeRef);
  // Iterative DFS traverses nodes connected by label references
  while (stack.length > 0) {
    const currentNodeRef = stack.pop()!;
    nodesUsed.push(currentNodeRef);

    const axTree = (await client.send('Accessibility.getPartialAXTree', {
      backendNodeId: currentNodeRef.backendId,
    })) as Protocol.Accessibility.GetPartialAXTreeResponse;

    // Find the index of the currentNodeRef's corresponding AXNode
    const indexOfCurrentNode = axTree.nodes.findIndex(
      axNode => axNode.backendDOMNodeId === currentNodeRef?.backendId
    );

    // Contains AXNodes descendant of currentNodeRef's corresponding AXNode
    const descandantNodes = axTree.nodes.slice(0, indexOfCurrentNode + 1);

    // Check if any descendant AXNodes are labelled
    for (const axNode of descandantNodes) {
      let labelNodes: Protocol.Accessibility.AXRelatedNode[] = [];
      const sources: Protocol.Accessibility.AXValueSource[] =
        axNode.name?.sources ?? [];

      for (const source of sources) {
        if (source.type === 'relatedElement') {
          // Handles nodes connected by attribute value (aria-labelleby)
          if (source.attributeValue?.relatedNodes) {
            labelNodes = source.attributeValue.relatedNodes;
            // Handles nodes connected natively (<label>)
          } else if (source.nativeSourceValue?.relatedNodes) {
            labelNodes = source.nativeSourceValue.relatedNodes;
          }
        }
      }

      // Repeat the process for all unvisited label nodes.
      for (const labelNode of labelNodes) {
        if (!visitedNodes.includes(labelNode.backendDOMNodeId)) {
          const labelNodeRef = await getNodeRefFromBackendId(
            labelNode.backendDOMNodeId,
            client,
            page
          );
          if (labelNodeRef) {
            stack.push(labelNodeRef);
          }
          visitedNodes.push(labelNode.backendDOMNodeId);
        }
      }
    }
  }

  // Sorting the nodes by dom order
  const n = nodesUsed.length;
  const nodeOrderMatrix: number[][] = [...Array(n)].map(() => Array(n).fill(0));

  for (const first of nodesUsed) {
    for (const second of nodesUsed) {
      const i = nodesUsed.indexOf(first);
      const j = nodesUsed.indexOf(second);
      nodeOrderMatrix[i][j] = await page.evaluate(
        (first, second) => {
          const relativePosition = first.compareDocumentPosition(second);
          if (relativePosition & Node.DOCUMENT_POSITION_PRECEDING) {
            return 1;
          } else if (relativePosition & Node.DOCUMENT_POSITION_FOLLOWING) {
            return -1;
          } else {
            return 0;
          }
        },
        first.handle,
        second.handle
      );
    }
  }

  nodesUsed.sort(
    (first, second) =>
      nodeOrderMatrix[nodesUsed.indexOf(first)][nodesUsed.indexOf(second)]
  );

  return nodesUsed;
}
