import { expect } from '@playwright/test';
import { ContentTypes } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { Page, Response } from '@playwright/test';

/** Substring of the reply emitted by the mock LLM server. */
export const MOCK_REPLY_TEXT = 'E2E mock reply';

/** Custom endpoints defined in e2e/config/librechat.e2e.yaml. */
export const MOCK_ENDPOINTS = [
  { label: 'Mock Provider A', model: 'mock-model-a' },
  { label: 'Mock Provider B', model: 'mock-model-b' },
] as const;

export type MockEndpoint = { label: string; model: string };

export const NEW_CHAT_PATH = '/c/new';

type RefreshTokenBody = {
  token?: string;
};

type AgentGenerationStart = {
  conversationId?: string;
};

type CompletionOptions = {
  timeout?: number;
};

const DEFAULT_COMPLETION_TIMEOUT = 20_000;

export function isAgentsStream(response: Response) {
  return isAgentGenerationStart(response);
}

export function isAgentGenerationStart(response: Response) {
  const { pathname } = new URL(response.url());
  const isAgentsChat = pathname === '/api/agents/chat' || pathname.startsWith('/api/agents/chat/');
  return (
    response.request().method() === 'POST' &&
    isAgentsChat &&
    !pathname.endsWith('/abort') &&
    response.status() === 200
  );
}

/**
 * Dense Session chrome: bookmarks / export / share / MCP / skills live in SessionPanel.
 * Open via the always-visible summary pill (aria-label Session menu).
 */
export async function openSessionSheet(page: Page) {
  const sheet = page.getByTestId('session-sheet');
  if (await sheet.isVisible().catch(() => false)) {
    return;
  }
  const summaryPill = page.getByTestId('session-summary-pill');
  await expect(summaryPill).toBeVisible({ timeout: 15000 });
  await summaryPill.click();
  await expect(sheet).toBeVisible({ timeout: 15000 });
}

/**
 * Dense Session chrome: the model chip lives in Session → Now (`session-sheet-model`).
 * When `sessionMenu` is off, it is the standalone `session-model-chip`.
 * Nested endpoint→model Ariakit flyouts do not stay open under Session's OGDialog
 * (same class of bug as MCPSubMenu) — callers should pick via root `#model-search`.
 *
 * Session ModelSelector uses `portal={false}` so ComboboxList options stay inside
 * the sheet DOM/a11y tree (body-portaled options stay invisible to getByRole even
 * when `#model-search` is CSS-visible under a dialog layer).
 */
/**
 * Dense Session chrome: open Session → model search (or the standalone chip).
 * Never click a missing "Select a model" landing control — sessionMenu ON
 * mounts the summary pill instead.
 */
export async function openModelSelector(page: Page) {
  /**
   * With sessionMenu ON, composer mounts `session-summary-pill` (not the chip).
   * A one-shot isVisible() races startup remounts and falls through to the chip
   * path, which never appears. Wait for either control, then prefer the pill.
   */
  const summaryPill = page.getByTestId('session-summary-pill');
  const chipTrigger = page.getByTestId('session-model-chip').getByTestId('model-selector-button');

  await expect(async () => {
    const pillVisible = await summaryPill.isVisible().catch(() => false);
    const chipVisible = await chipTrigger.isVisible().catch(() => false);
    expect(pillVisible || chipVisible).toBe(true);
  }).toPass({ timeout: 15000 });

  if (await summaryPill.isVisible().catch(() => false)) {
    await openSessionSheet(page);
    const sheetTrigger = page
      .getByTestId('session-sheet-model')
      .getByTestId('model-selector-button');
    await expect(sheetTrigger).toBeVisible({ timeout: 15000 });
    await sheetTrigger.scrollIntoViewIfNeeded();
    await sheetTrigger.click({ timeout: 10000 });
    return sheetTrigger;
  }

  await expect(chipTrigger).toBeVisible({ timeout: 15000 });
  await chipTrigger.click({ timeout: 10000 });
  return chipTrigger;
}

/** Flat search option for a model id / spec label once `#model-search` is open. */
async function selectModelSearchOption(
  page: Page,
  query: string,
  optionName: string | RegExp = query,
) {
  const search = page.locator('#model-search');
  await expect(search).toBeVisible({ timeout: 10000 });
  await search.click({ timeout: 5000 });
  await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10000 });

  const byTestId = page.getByTestId(`model-search-option-${query}`);
  const byRole =
    typeof optionName === 'string'
      ? page.getByRole('option', { name: optionName, exact: true })
      : page.getByRole('option', { name: optionName });
  /** Prefer stable test id (model id), then role name, then exact text in the listbox. */
  const option = byTestId
    .or(byRole)
    .or(page.getByRole('listbox').getByText(optionName, { exact: typeof optionName === 'string' }));

  /** Search is debounced 200ms; remounts on each committed query. */
  await expect(async () => {
    await search.fill('');
    await search.pressSequentially(query, { delay: 15 });
    await expect(option.first()).toBeVisible({ timeout: 2500 });
  }).toPass({ timeout: 15000 });

  await option.first().scrollIntoViewIfNeeded();
  await option.first().click({ timeout: 10000 });
}

async function assertModelSelection(
  page: Page,
  expected: string | { model: string; label?: string },
) {
  const expectedTexts =
    typeof expected === 'string'
      ? [expected]
      : [expected.model, expected.label].filter((value): value is string => Boolean(value));
  const match = new RegExp(expectedTexts.map(escapeRegExp).join('|'));

  const sheet = page.getByTestId('session-sheet');
  if (await sheet.isVisible().catch(() => false)) {
    await closeSessionSheet(page);
  }

  const summary = page.getByTestId('session-summary-model');
  if (await summary.isVisible().catch(() => false)) {
    await expect(summary).toContainText(match, { timeout: 10000 });
    return;
  }

  await expect(
    page.getByTestId('session-model-chip').getByTestId('model-selector-button'),
  ).toContainText(match, { timeout: 10000 });
}

export async function closeSessionSheet(page: Page) {
  const sheet = page.getByTestId('session-sheet');
  if (!(await sheet.isVisible().catch(() => false))) {
    return;
  }
  /**
   * Session chrome remounts during MCP catalog warmup / nested menus, so the
   * Close control is often "not stable" or detaches under a direct click.
   * Escape closes the sheet (and any leftover menu) without waiting on that
   * button; force-click the stable testid as a fallback — do not rely on the
   * English aria-label alone (remount + locale make getByRole('Close') flake).
   */
  await page.keyboard.press('Escape');
  if (await sheet.isVisible().catch(() => false)) {
    const closeButton = page.getByTestId('session-sheet-close');
    await expect(async () => {
      if (!(await sheet.isVisible().catch(() => false))) {
        return;
      }
      await closeButton.click({ force: true, timeout: 3000 });
      await expect(sheet).toBeHidden({ timeout: 3000 });
    }).toPass({ timeout: 15000 });
  }
  await expect(sheet).toBeHidden({ timeout: 15000 });
}

/** Bookmark control in the composer chrome cluster (dense v5.1). */
export function sessionBookmarkButton(page: Page) {
  return page.getByTestId('composer-chrome-cluster').getByTestId('bookmark-menu');
}

/** Export/Share trigger in the composer chrome cluster (dense v5.1). */
export function sessionExportButton(page: Page) {
  return page.getByTestId('composer-chrome-cluster').getByRole('button', { name: /Export\/Share/ });
}

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Open Session → Tools → MCP Servers (dense v5; MCP is no longer a composer badge).
 * Leaves the sheet on the MCP view with the inline server list visible.
 */
export async function openSessionMcpMenu(page: Page) {
  await openSessionSheet(page);
  const sheet = page.getByTestId('session-sheet');
  const mcpSection = sheet.getByTestId('session-menu-mcp');
  if (!(await mcpSection.isVisible().catch(() => false))) {
    /** Wait for the MCP catalog (stdio e2e-memory included) before navigating. */
    const mcpNav = sheet.getByRole('button', { name: /MCP Servers/ });
    await expect(mcpNav).toBeVisible({ timeout: 30000 });
    /**
     * ToolGrid remounts the MCP nav as `availableMCPServers` warms; a single
     * click often hits "not stable" / detached. Retry with force until the
     * inline server list is actually mounted.
     */
    await expect(async () => {
      await mcpNav.click({ force: true, timeout: 5000 });
      await expect(mcpSection).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
  }
  await expect(sheet.getByTestId('session-mcp-server-list')).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Stable MCP server row — nested Cancel/Connect buttons often remove the
 * checkbox from the a11y tree, so prefer `data-testid` over getByRole.
 */
export function sessionMcpServer(page: Page, serverName: string) {
  return page.getByTestId(`session-mcp-server-${serverName}`);
}

/** Select an ephemeral MCP server from Session → Tools → MCP, then close the sheet. */
export async function selectSessionMcpServer(page: Page, serverName: string) {
  await openSessionMcpMenu(page);
  const serverItem = sessionMcpServer(page, serverName);
  await expect(serverItem).toBeVisible({ timeout: 15000 });
  if ((await serverItem.getAttribute('aria-checked')) !== 'true') {
    await serverItem.click();
  }
  await expect(serverItem).toHaveAttribute('aria-checked', 'true');
  await closeSessionSheet(page);
}

/** Close MCP config / OAuth dialogs that block Session sheet re-entry. */
export async function dismissMcpConfigDialog(page: Page) {
  const continueOAuth = page.getByRole('button', { name: 'Continue with OAuth' });
  if (await continueOAuth.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(continueOAuth).toHaveCount(0, { timeout: 10000 });
  }
  const authenticate = page.getByRole('button', { name: 'Authenticate', exact: true });
  if (await authenticate.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(authenticate).toHaveCount(0, { timeout: 10000 });
  }
}

/**
 * Re-open Session → MCP if the sheet remounted or Escape closed it.
 * OAuth readiness polls can remount Session chrome; callers must re-bind
 * checkbox locators after this rather than reuse a stale handle.
 */
export async function ensureSessionMcpMenu(page: Page) {
  await dismissMcpConfigDialog(page);
  await expect(async () => {
    await openSessionMcpMenu(page);
    const list = page.getByTestId('session-mcp-server-list');
    await expect(list).toBeVisible({ timeout: 5000 });
    await expect(list.locator('[data-testid^="session-mcp-server-"]').first()).toBeVisible({
      timeout: 5000,
    });
  }).toPass({ timeout: 30000 });
}

/**
 * Cancel / Connect live as nested `<button>`s inside the checkbox row.
 * Nested interactives are often missing from the a11y tree, so use DOM
 * aria-label queries on the stable server testid rather than getByRole.
 */
export function sessionMcpServerCancel(page: Page, serverName: string) {
  return sessionMcpServer(page, serverName).locator('button[aria-label="Cancel"]');
}

export function sessionMcpServerConnect(page: Page, serverName: string) {
  return sessionMcpServer(page, serverName).locator(`button[aria-label="Connect ${serverName}"]`);
}

/** Landing model control: Session pill when sessionMenu is on, else the chip. */
export function landingModelControl(page: Page) {
  return page
    .getByTestId('session-summary-pill')
    .or(page.getByTestId('session-model-chip').getByTestId('model-selector-button'));
}

/**
 * Visible selected-model label on the Session pill (or chip). Prefer this over
 * `getByRole('button', { name: 'Select a model' })` — that landing control is
 * gone when sessionMenu mounts the summary pill.
 */
export function selectedModelLabel(page: Page) {
  return page
    .getByTestId('session-summary-model')
    .or(page.getByTestId('session-model-chip').getByTestId('model-selector-button'));
}

/**
 * Open Session → model selector (or the standalone chip), search for the mock
 * model id, and commit via the flat search option — not the nested endpoint submenu.
 */

export async function selectMockEndpoint(page: Page, endpoint: MockEndpoint) {
  /**
   * Mock Provider A/B are modelSpecs only (not in `addedEndpoints`). Search must
   * match `preset.model` and the option must expose
   * `data-testid=model-search-option-${model}` (spec rows included). If the
   * model-id option still does not mount, fall back to the provider label —
   * same selectable row — then accept either model id or label in the summary
   * (specs display the label).
   */
  const summary = page.getByTestId('session-summary-model');
  if (await summary.isVisible().catch(() => false)) {
    const text = (await summary.textContent()) ?? '';
    if (text.includes(endpoint.model) || text.includes(endpoint.label)) {
      return;
    }
  }
  const chipTrigger = page.getByTestId('session-model-chip').getByTestId('model-selector-button');
  if (await chipTrigger.isVisible().catch(() => false)) {
    const text = (await chipTrigger.textContent()) ?? '';
    if (text.includes(endpoint.model) || text.includes(endpoint.label)) {
      return;
    }
  }

  await openModelSelector(page);

  const byModelId = page.getByTestId(`model-search-option-${endpoint.model}`);
  try {
    await selectModelSearchOption(page, endpoint.model);
  } catch (modelErr) {
    // Prove the primary path failed because the option was missing, then use label.
    if ((await byModelId.count()) === 0) {
      await selectModelSearchOption(page, endpoint.label, endpoint.label);
    } else {
      throw modelErr;
    }
  }

  await assertModelSelection(page, { model: endpoint.model, label: endpoint.label });
}

/** Open the model selector and choose a configured model spec by label. */
export async function selectModelSpec(page: Page, label: string) {
  const summary = page.getByTestId('session-summary-model');
  if (
    (await summary.isVisible().catch(() => false)) &&
    (await summary.textContent())?.includes(label)
  ) {
    return;
  }
  const chipTrigger = page.getByTestId('session-model-chip').getByTestId('model-selector-button');
  if (
    (await chipTrigger.isVisible().catch(() => false)) &&
    (await chipTrigger.textContent())?.includes(label)
  ) {
    return;
  }

  await openModelSelector(page);
  await selectModelSearchOption(page, label, new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`));
  await assertModelSelection(page, label);
}

/** Open Session → Agent picker and select an agent by display name. */
export async function selectChatAgent(page: Page, agentName: string) {
  const label = selectedModelLabel(page);
  if (
    (await label.isVisible().catch(() => false)) &&
    (await label.textContent())?.includes(agentName)
  ) {
    return;
  }

  /**
   * Session pill → sheet → Agent picker (not a landing "Select a model" chip).
   * Newly created agents may lag the agentsMap; retry search until the option mounts.
   */
  await openSessionSheet(page);
  const pickerButton = page.getByTestId('session-sheet').getByTestId('agent-picker-button');
  await expect(pickerButton).toBeVisible({ timeout: 15000 });
  await pickerButton.click();

  const list = page.getByTestId('agent-picker-list');
  await expect(list).toBeVisible({ timeout: 15000 });
  const search = page.getByRole('searchbox', { name: 'Search agents' });
  await expect(search).toBeVisible({ timeout: 10000 });

  const option = list.getByRole('option', { name: agentName });
  await expect(async () => {
    await search.fill('');
    await search.fill(agentName);
    await expect(option).toBeVisible({ timeout: 2500 });
  }).toPass({ timeout: 30000 });

  await option.click();
  await expect(list).toBeHidden({ timeout: 10000 });
  await assertModelSelection(page, agentName);
}

/** Enable Skills from Session → Skills (dense Session chrome). */
export async function enableSkills(page: Page) {
  await openSessionSheet(page);
  const sheet = page.getByTestId('session-sheet');
  if (
    !(await sheet
      .getByTestId('session-menu-skills')
      .isVisible()
      .catch(() => false))
  ) {
    await sheet.getByRole('button', { name: 'Skills' }).click();
    await expect(sheet.getByTestId('session-menu-skills')).toBeVisible();
  }
  /**
   * Drill Skills view mounts `session-skills-toggle` (master arm). Prefer the
   * stable testid — role name alone races remounts / per-skill switches.
   */
  const toggle = sheet
    .getByTestId('session-skills-toggle')
    .or(sheet.getByRole('switch', { name: 'Skills' }));
  await expect(toggle).toBeVisible({ timeout: 15000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSessionSheet(page);
}

/** Enable Memory from Session → Tools (dense Session chrome). */
export async function enableMemory(page: Page) {
  await openSessionSheet(page);
  const toggle = page.getByTestId('session-sheet').getByRole('switch', { name: 'Memory' });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSessionSheet(page);
}

/** Enable Code Interpreter from Session → Tools (dense Session chrome). */
export async function enableCodeInterpreter(page: Page) {
  await openSessionSheet(page);
  const toggle = page.getByTestId('session-sheet').getByRole('switch', { name: 'Run Code' });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSessionSheet(page);
}

/** Enable File Search from Session → Tools (dense Session chrome). */
export async function enableFileSearch(page: Page) {
  await openSessionSheet(page);
  const toggle = page.getByTestId('session-sheet').getByRole('switch', { name: 'File Search' });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSessionSheet(page);
}

/** The conversation messages container. */
export const messagesView = (page: Page) => page.getByTestId('messages-view');

/** Build the mock-model reply trigger and its expected rendered text for a label. */
export const replyPrompt = (label: string) => `E2E_REPLY:${label}`;
export const replyText = (label: string) => `E2E reply ${label}`;

/** Same, for a reply that streams a reasoning part ahead of its text part. */
export const thinkPrompt = (label: string) => `E2E_THINK_REPLY:${label}`;
export const thinkText = (label: string) => `E2E reasoning ${label}`;

/** The mock reply as rendered in the conversation, scoped to the messages view. */
export function mockReply(page: Page) {
  return messagesView(page).getByText(new RegExp(MOCK_REPLY_TEXT, 'i'));
}

/**
 * Type a message and wait only for generation admission. Use this lower-level
 * helper when a test intentionally observes a live, paused, aborted, or failed run.
 */
export async function sendMessage(page: Page, text: string): Promise<Response> {
  const input = page.getByRole('textbox', { name: 'Message input' });
  await input.click();
  await input.fill(text);
  const [response] = await Promise.all([
    page.waitForResponse(isAgentsStream, { timeout: 30000 }),
    input.press('Enter'),
  ]);
  return response;
}

function formatPersistedMessages(messages: TMessage[]): string {
  return JSON.stringify(
    messages.map(
      ({ content, error, isCreatedByUser, messageId, parentMessageId, text, unfinished }) => ({
        messageId,
        parentMessageId,
        isCreatedByUser,
        unfinished,
        error,
        text: typeof text === 'string' ? text.slice(0, 200) : text,
        content: content?.map((part) => ({
          type: part?.type,
          ...(part?.type === ContentTypes.ERROR
            ? { error: part[ContentTypes.ERROR], text: part.text }
            : {}),
        })),
      }),
    ),
    null,
    2,
  );
}

function conversationIdFromUrl(url: string): string | undefined {
  const match = new URL(url).pathname.match(/^\/c\/([^/]+)\/?$/);
  const conversationId = match?.[1];
  return conversationId && conversationId !== 'new'
    ? decodeURIComponent(conversationId)
    : undefined;
}

/**
 * Send a message and require the resulting assistant response to be durably finalized.
 * A streamed answer is not success until its persisted message is terminal and error-free.
 */
export async function sendMessageAndWaitForCompletion(
  page: Page,
  text: string,
  options: CompletionOptions = {},
): Promise<Response> {
  const token = await getAccessToken(page);
  const existingConversationId = conversationIdFromUrl(page.url());
  /** The POST messageId is an optimistic UI placeholder; BaseClient persists a
   * server-generated user ID. Snapshot history before admission so the new
   * canonical user→assistant edge can be identified without matching prompt text. */
  const existingMessages = existingConversationId
    ? await fetchJson<TMessage[]>(
        page,
        `/api/messages/${encodeURIComponent(existingConversationId)}`,
        token,
      )
    : [];
  const existingMessageIds = new Set(existingMessages.map((message) => message.messageId));

  const response = await sendMessage(page, text);
  const start = (await response.json()) as AgentGenerationStart;
  const conversationId = start.conversationId;

  if (!conversationId || conversationId === 'new') {
    throw new Error(
      `Generation admission did not identify a persisted turn: ${JSON.stringify({
        conversationId,
      })}`,
    );
  }
  if (existingConversationId && existingConversationId !== conversationId) {
    throw new Error(
      `Generation admission changed conversations unexpectedly: ${JSON.stringify({
        existingConversationId,
        conversationId,
      })}`,
    );
  }

  let assistantMessages: TMessage[] = [];
  let newMessages: TMessage[] = [];
  let latestMessages: TMessage[] = [];
  let latestReadError: string | undefined;

  try {
    await expect
      .poll(
        async () => {
          try {
            latestMessages = await fetchJson<TMessage[]>(
              page,
              `/api/messages/${encodeURIComponent(conversationId)}`,
              token,
            );
            latestReadError = undefined;
          } catch (error) {
            latestReadError = error instanceof Error ? error.message : String(error);
            return false;
          }

          newMessages = latestMessages.filter(
            (message) => !existingMessageIds.has(message.messageId),
          );
          const userMessageIds = new Set(
            newMessages
              .filter((message) => message.isCreatedByUser === true)
              .map((message) => message.messageId),
          );
          assistantMessages = newMessages.filter(
            (message) =>
              message.isCreatedByUser === false &&
              message.parentMessageId != null &&
              userMessageIds.has(message.parentMessageId),
          );
          return (
            userMessageIds.size > 0 &&
            assistantMessages.length > 0 &&
            assistantMessages.every((message) => message.unfinished === false)
          );
        },
        {
          timeout: options.timeout ?? DEFAULT_COMPLETION_TIMEOUT,
          intervals: [250, 500, 1_000],
          message: 'new assistant response should be durably finalized',
        },
      )
      .toBe(true);
  } catch (error) {
    const pollError = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        'Timed out waiting for the new assistant response to be durably finalized.',
        latestReadError ? `Latest message read failed: ${latestReadError}` : undefined,
        `Pre-existing message IDs: ${JSON.stringify([...existingMessageIds])}`,
        `New persisted messages: ${formatPersistedMessages(newMessages)}`,
        `Persisted messages: ${formatPersistedMessages(latestMessages)}`,
        pollError,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const failedMessage = assistantMessages.find(
    (message) =>
      message.error === true ||
      message.content?.some((part) => part?.type === ContentTypes.ERROR) === true,
  );
  if (failedMessage) {
    throw new Error(
      `Persisted assistant response contains an unexpected error: ${formatPersistedMessages([
        failedMessage,
      ])}`,
    );
  }

  if (!existingConversationId) {
    await expect
      .poll(() => conversationIdFromUrl(page.url()), {
        timeout: 5_000,
        intervals: [100, 250, 500],
        message: 'new conversation route should use the admitted conversation ID',
      })
      .toBe(conversationId);
  }

  return response;
}

export async function getAccessToken(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, text, json };
  });

  if (!result.ok) {
    throw new Error(
      `Expected /api/auth/refresh to return 2xx, got ${result.status}: ${result.text}`,
    );
  }

  const body = result.json as RefreshTokenBody | null;
  if (!body?.token) {
    throw new Error(`Expected /api/auth/refresh to return a token, got: ${result.text}`);
  }

  return body.token;
}

export async function requestJson<T>(
  page: Page,
  params: {
    path: string;
    token: string;
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const result = await page.evaluate(
    async ({ accessToken, body, method, urlPath }) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      const init: RequestInit = {
        method,
        credentials: 'include',
        headers,
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(urlPath, init);
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { ok: response.ok, status: response.status, text, json };
    },
    {
      accessToken: params.token,
      body: params.body,
      method: params.method ?? 'GET',
      urlPath: params.path,
    },
  );

  if (!result.ok) {
    throw new Error(
      `Expected ${params.method ?? 'GET'} ${params.path} to return 2xx, got ${result.status}: ${result.text}`,
    );
  }
  return result.json as T;
}

export async function fetchJson<T>(page: Page, path: string, token: string): Promise<T> {
  return requestJson<T>(page, { path, token });
}

/** Base URLs of the fake code-exec + RAG servers started by playwright.config.mock.ts. */
/** Defaults must match `playwright.config.mock.ts`, which keeps these clear of
 *  the MCP (8765/8766) and label (8889) fixtures. */
export const CODE_API_BASE = `http://127.0.0.1:${process.env.E2E_CODE_API_PORT || '8790'}`;
export const RAG_API_BASE = `http://127.0.0.1:${process.env.E2E_RAG_API_PORT || '8791'}`;

export type CodeProvisionRecord = {
  filename: string;
  kind: string;
  id: string;
  storage_session_id: string;
  fileId: string;
};

export type RagEmbedRecord = { file_id: string; filename: string; entity_id: string };

/** Files the fake code server received via /upload (proof they reached the code env). */
export async function getCodeProvisionedUploads(page: Page): Promise<CodeProvisionRecord[]> {
  const response = await page.request.get(`${CODE_API_BASE}/__debug/uploads`);
  expect(response.ok(), 'fake code server /__debug/uploads should respond').toBeTruthy();
  const body = (await response.json()) as { uploads: CodeProvisionRecord[] };
  return body.uploads;
}

/** Files the fake RAG server embedded via /embed (proof they reached the vector DB). */
export async function getRagEmbedded(page: Page): Promise<RagEmbedRecord[]> {
  const response = await page.request.get(`${RAG_API_BASE}/__debug/embedded`);
  expect(response.ok(), 'fake RAG server /__debug/embedded should respond').toBeTruthy();
  const body = (await response.json()) as { embedded: RagEmbedRecord[] };
  return body.embedded;
}

/** Clear both fake servers' recorded provisioning (call at test start for isolation). */
export async function resetProvisioning(page: Page): Promise<void> {
  await Promise.all([
    page.request.post(`${CODE_API_BASE}/__debug/reset`),
    page.request.post(`${RAG_API_BASE}/__debug/reset`),
  ]);
}

/** Shape of a file record as returned by POST /api/files and GET /api/files. */
export type UploadedFile = {
  file_id?: string;
  filename?: string;
  type?: string;
  llmDeliveryPath?: string;
  embedded?: boolean;
  metadata?: { codeEnvRef?: { storage_session_id?: string; file_id?: string } };
};

export type AttachFile = { name: string; mimeType: string; content: string };

/** Unique, filesystem-safe name so tests never collide on accumulated fake-server state. */
export const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const isFilesUpload = (url: string, method: string) =>
  method === 'POST' && /\/api\/files(?:\?|$)/.test(new URL(url).pathname);

/** Wait for the next POST /api/files upload response. */
export function waitForUpload(page: Page) {
  return page.waitForResponse((r) => isFilesUpload(r.url(), r.request().method()), {
    timeout: 30000,
  });
}

/** Attach a file via the composer attach menu's "Add file" (no tool resource). */
export async function uploadViaUnifiedButton(page: Page, file: AttachFile) {
  const uploadResponse = waitForUpload(page);
  await expect(page.getByTestId('composer-attach-file')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('composer-attach-file').click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: 'Add file' }).click(),
  ]);
  await fileChooser.setFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.content, 'utf8'),
  });
  return uploadResponse;
}

/** Attach a file via a named option in the legacy 3-way dropdown. */
export async function uploadViaLegacyOption(page: Page, optionName: string, file: AttachFile) {
  const uploadResponse = waitForUpload(page);
  await page.locator('#attach-file-menu-button').click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: optionName }).click(),
  ]);
  await fileChooser.setFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.content, 'utf8'),
  });
  return uploadResponse;
}
