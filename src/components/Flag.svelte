<script lang="ts">
  // Bandeiras desenhadas aqui: emoji de bandeira não existe no Windows (vira "BR"/"US")
  // e no Linux depende da fonte instalada.
  let { lang, width = 32 }: { lang: 'pt-BR' | 'en-US'; width?: number } = $props();
  const height = $derived(Math.round(width * 0.7));
  const stars = Array.from({ length: 20 }, (_, i) => ({ x: 0.75 + (i % 5) * 1.5 + (Math.floor(i / 5) % 2) * 0.75, y: 0.7 + Math.floor(i / 5) * 1.25 }));
</script>

{#if lang === 'pt-BR'}
  <svg class="flag" {width} {height} viewBox="0 0 20 14" role="img" aria-label="Brasil">
    <rect width="20" height="14" fill="#009c3b" />
    <polygon points="10,1.5 18.5,7 10,12.5 1.5,7" fill="#ffdf00" />
    <circle cx="10" cy="7" r="3.5" fill="#002776" />
    <path d="M6.6 6.3 Q10 5.2 13.4 7.6" stroke="#ffffff" stroke-width="0.7" fill="none" />
  </svg>
{:else}
  <svg class="flag" {width} {height} viewBox="0 0 20 14" role="img" aria-label="United States">
    <rect width="20" height="14" fill="#ffffff" />
    {#each [0, 2, 4, 6, 8, 10, 12] as i (i)}
      <rect y={(i * 14) / 13} width="20" height={14 / 13} fill="#b22234" />
    {/each}
    <rect width="8.4" height={(7 * 14) / 13} fill="#3c3b6e" />
    {#each stars as s, i (i)}
      <circle cx={s.x} cy={s.y} r="0.32" fill="#ffffff" />
    {/each}
  </svg>
{/if}

<style>
  .flag {
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.18);
    flex: 0 0 auto;
    display: block;
  }
</style>
