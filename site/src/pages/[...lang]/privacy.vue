<template>
  <div class="privacy-page sidebar-layout">
    <Header />

    <main class="max-w-210 mx-auto px-5 py-12 md:px-10 md:py-16 text-dark-c">
      <div class="mb-10">
        <div class="hstack gap-3 mb-3">
          <span class="circle size-10 bg-brand text-white">
            <span i-mdi:shield-lock-outline text-xl />
          </span>
          <h1 class="text-3xl font-bold">Privacy Policy</h1>
        </div>
        <p class="text-sm text-light-c">Last updated: September 2, 2026</p>
      </div>

      <div class="privacy-content">
        <p>
          Markdown Resume is designed as a <strong>local-first application</strong>. You
          can create and manage your résumés without creating an account or sending your
          personal content to an application server. The optional AI assistant, described
          below, is the one exception — and it is off unless you deliberately turn it on.
        </p>

        <section>
          <h2>Résumé and image data</h2>
          <p>
            Your résumé content, document settings, and uploaded images are stored locally
            in your browser using <strong>IndexedDB</strong>. This information stays on
            your device. It is not uploaded to, processed by, or saved on our servers,
            unless you send it through the optional AI assistant below.
          </p>
          <p>
            Because the data is local to your browser, clearing site data, using a
            different browser or device, or removing the browser profile may make it
            unavailable. Use the available export and backup features to keep copies of
            information you do not want to lose.
          </p>
        </section>

        <section>
          <h2>AI writing assistance (optional, off by default)</h2>
          <p>
            The editor can include AI writing tools that edit or suggest changes to your
            résumé. They stay hidden until a proxy token is pasted into
            <strong>Settings</strong>. Without that token the tools never appear and
            nothing in this section applies to you.
          </p>
          <p>
            When enabled, what you type in the editor tool — including any résumé content
            the assistant reads or writes — is sent to a self-hosted Cloudflare Worker,
            which forwards it to the AI provider you pick in Settings:
            <a href="https://opencode.ai" target="_blank" rel="noopener">OpenCode Go</a>
            or
            <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a>.
            What those providers do with the content is governed by their own privacy
            policies. The worker does not log message bodies.
          </p>
          <p>
            History storage is <strong>Off</strong> by default: chats live only in the
            open page and are gone on reload. Set it to <strong>Server</strong> and each
            completed turn (your message and the assistant's reply) is stored in the
            worker's Cloudflare D1 database until it is deleted from there.
          </p>
        </section>

        <section>
          <h2>Analytics &amp; tracking</h2>
          <p>
            This application does not use analytics or tracking services. No analytics
            scripts are loaded, and no usage data is collected or transmitted to third
            parties.
          </p>
        </section>

        <section>
          <h2>Data sharing</h2>
          <p>
            We do not sell your personal information. Résumé and image data stored by this
            app are not shared with third parties because they remain in your browser —
            apart from what you choose to send through the AI assistant, which goes to the
            provider you selected.
          </p>
        </section>

        <section>
          <h2>Changes to this policy</h2>
          <p>
            We may update this policy when the application changes. The latest version and
            its revision date will be published on this page.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For questions about this privacy policy, visit the
            <a
              href="https://github.com/yashanshu/markdown-resume"
              target="_blank"
              rel="noopener"
              >repository</a
            >.
          </p>
        </section>
      </div>
    </main>
  </div>
</template>

<script lang="ts" setup>
useHead({ title: "Privacy Policy — Markdown Resume" });
</script>

<style scoped>
.privacy-content {
  @apply space-y-8 leading-7 text-gray-700 dark:text-gray-200;
}

.privacy-content section {
  @apply space-y-3;
}

.privacy-content h2 {
  @apply text-xl font-bold text-black dark:text-white;
}

.privacy-content a {
  @apply text-brand underline underline-offset-2;
}
</style>
