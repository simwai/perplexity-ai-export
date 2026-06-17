# Changelog

# [1.2.0](https://github.com/simwai/perplexity-ai-export/compare/v1.1.0...v1.2.0) (2026-06-17)


### Bug Fixes

* added missing ripgrep platform binary and bypass Windows execution block ([50b7b8e](https://github.com/simwai/perplexity-ai-export/commit/50b7b8e67f07335945e3ce7ffd20b0fb87e251c3))
* correct RRF paper citation link (SIGIR 2009, not arXiv) ([8c13532](https://github.com/simwai/perplexity-ai-export/commit/8c1353294974af6ae071c6e2c4b3689be0c9902a))
* fixed more bugs and added launch.json for better debugging experience in VS code ([cfb39d2](https://github.com/simwai/perplexity-ai-export/commit/cfb39d24f286a7bb63d82b2a82f06a86d1aee152))
* fixed some critical bugs ([290854d](https://github.com/simwai/perplexity-ai-export/commit/290854dfbfc028a1972538971a1622bb5a8ac6aa))
* fixed that not all threads were found ([1751caa](https://github.com/simwai/perplexity-ai-export/commit/1751caa168b0ec330a0e89e7385c9bc3c0e4f127))
* implement interactive auth refresh and retry loop ([#40](https://github.com/simwai/perplexity-ai-export/issues/40)) ([5ee8c99](https://github.com/simwai/perplexity-ai-export/commit/5ee8c9992ba87c1eb11973709ec0ba776193b7b8))
* implemented the fixes of the discussion on PR [#39](https://github.com/simwai/perplexity-ai-export/issues/39) ([6242b9d](https://github.com/simwai/perplexity-ai-export/commit/6242b9da94ed3891c11ab1e1e28257119a79f279))
* library discovery race condition and pagination bugs ([#35](https://github.com/simwai/perplexity-ai-export/issues/35)) ([3f68856](https://github.com/simwai/perplexity-ai-export/commit/3f688564175ee7cfc554e5030e6ac8e8be1fd2f1))
* made path handling more robust and improved launch.json ([06b2ecb](https://github.com/simwai/perplexity-ai-export/commit/06b2ecbd99829543dbc0d19599ca00061f94f61f))
* rewrite benchmark to match project style (logger, config, errorBus) ([758ecd6](https://github.com/simwai/perplexity-ai-export/commit/758ecd63fa44b8cc16299790dd1e60c2dd2ee8b2))
* **scraper:** handle paginated API responses and improve diagnostics ([ac0f940](https://github.com/simwai/perplexity-ai-export/commit/ac0f940bbb6b6ecab1c18c0febf072ef1d1c02f0))
* **scraper:** handle paginated API responses and improve diagnostics ([3692e95](https://github.com/simwai/perplexity-ai-export/commit/3692e95cce55dc7bd8b0187dba07ba476deefc8b))
* **scraper:** handle paginated API responses and improve diagnostics ([#24](https://github.com/simwai/perplexity-ai-export/issues/24)) ([eae2acf](https://github.com/simwai/perplexity-ai-export/commit/eae2acf186d7da85ad491c25ce4b69a66752f260))
* update API response parsing for current Perplexity endpoints ([#20](https://github.com/simwai/perplexity-ai-export/issues/20)) ([08d3958](https://github.com/simwai/perplexity-ai-export/commit/08d39582dee98d5c509aaf4e786623b854dd9ed5))
* updated navigation timeout in BrowserManager ([c6a12ab](https://github.com/simwai/perplexity-ai-export/commit/c6a12ab37cfcae6b63b124f7d2e2a6406b09d10d))


### Features

* add HyDE, bump pool limit, cross-encoder reranking, benchmark script ([6d530d6](https://github.com/simwai/perplexity-ai-export/commit/6d530d6b35aa47dbd1c2875a3c1cd0acbcfad8a1))
* added retries and auto increase of timeout on failing requests to improve resilience ([0a4788f](https://github.com/simwai/perplexity-ai-export/commit/0a4788f1e0390704623e3ee0da0292f5486a39a7))
* bundle ripgrep and implement smart headless browser logic ([17980bf](https://github.com/simwai/perplexity-ai-export/commit/17980bf89b7f1f93737a97e887f894516b4fe2f4))
* implement diagnosis mode and refine issue templates ([#22](https://github.com/simwai/perplexity-ai-export/issues/22)) ([111ae2b](https://github.com/simwai/perplexity-ai-export/commit/111ae2bbea0822cb56b154a0cd5004c7bfa991d1))
* implement error bus pattern and rename diagnosis mode to debug mode ([#26](https://github.com/simwai/perplexity-ai-export/issues/26)) ([a265582](https://github.com/simwai/perplexity-ai-export/commit/a26558225c43a7315cb21419f37711a871e42615))
* implement smart TOC detection for markdown files ([#25](https://github.com/simwai/perplexity-ai-export/issues/25)) ([5a5f078](https://github.com/simwai/perplexity-ai-export/commit/5a5f078fda373ae99201d2a05270105e4a44e3a8))
* increased timeout of rg search ([ecd76dd](https://github.com/simwai/perplexity-ai-export/commit/ecd76ddc015afdfbe747b18e1184092d6e7c4726))
* **scraper:** improve menu clarity and modernize documentation style ([#31](https://github.com/simwai/perplexity-ai-export/issues/31)) ([46b090e](https://github.com/simwai/perplexity-ai-export/commit/46b090eb4d8c749582139a5f0e55a51f4cd21bed))

# 1.1.0 (2026-03-15)

### Bug Fixes

- Added logger import to rate-limiter.ts ([a033be2](https://github.com/simwai/perplexity-ai-export/commit/a033be2079a1f1c3d6571836db3b2774e6e7479c))
- Added Zod validation and fixed extraction logic in ConversationExtractor and added logging ([d2444fe](https://github.com/simwai/perplexity-ai-export/commit/d2444fed397591f77c06f70ceb7fabe5f946a3ac))
- removed duplicated exhaustiveMode variable in RagOrchestrator and ran formatter ([d397184](https://github.com/simwai/perplexity-ai-export/commit/d3971845ecf504fb031f6cc09cd54d244d376275))
- resolve compilation errors in RagOrchestrator ([e142476](https://github.com/simwai/perplexity-ai-export/commit/e1424766bedd8b37b10742781df94082d24e61af))
- resolve RAG orchestrator errors and optimize ripgrep search ([ccab7a4](https://github.com/simwai/perplexity-ai-export/commit/ccab7a49773ed519facdf765a0929a7a2036cbf6))
- resolve RAG orchestrator errors, optimize search and enhance logging ([d5d01da](https://github.com/simwai/perplexity-ai-export/commit/d5d01da7573b8253029367976224eb29c1e24209))
- resolve RAG orchestrator errors, optimize search and enhance logging ([b66b85c](https://github.com/simwai/perplexity-ai-export/commit/b66b85c4a8bc6eba976b48fdc65e70959f98613c))

### Features

- ✨ Init ([389ca9d](https://github.com/simwai/perplexity-ai-export/commit/389ca9df9e4bf52aa6690c7fe194a23e5732f4f0))
- add RAG search mode and cleanup codebase ([34b1aa3](https://github.com/simwai/perplexity-ai-export/commit/34b1aa30952c21c12314ef48c840698e686273bd))
- add SEA exe build and release-it for automated releases ([0499c66](https://github.com/simwai/perplexity-ai-export/commit/0499c666cb2775963decee074f21fc1a2b8d6794))
- advanced RAG search mode and comprehensive cleanup ([0813fee](https://github.com/simwai/perplexity-ai-export/commit/0813fee9797dca531b66e0ee7dc13169a519cb94))
- final 'Mightiest' adaptive RAG implementation ([fba81fd](https://github.com/simwai/perplexity-ai-export/commit/fba81fd1ef699c5d27dae09b5457fea111ea081e))
- implement 'Mightiest' adaptive RAG mode ([1c1c606](https://github.com/simwai/perplexity-ai-export/commit/1c1c6066a2d27ef7f3bc913b5c153f448486e4b7))
- Improved robustness and added reset functionality ([1e1d884](https://github.com/simwai/perplexity-ai-export/commit/1e1d884cdf30632cb7f1638962d56ef1ad4cb567))
- Improved scraper resilience with context recreation and retry logic ([c761214](https://github.com/simwai/perplexity-ai-export/commit/c7612147650f5591355e3eb9ca1738cd12839d8b))
- Init ([08bee2e](https://github.com/simwai/perplexity-ai-export/commit/08bee2e21434fc0dbb9b67a69ad3f3a2b8f4d08e))
- Refactored core logic into private methods and added custom error classes ([b8d2fe3](https://github.com/simwai/perplexity-ai-export/commit/b8d2fe381c19de9c012c2f56ce0afc3a3fea3a98))
- Refactored thread discovery to support dynamic API versioning ([7805412](https://github.com/simwai/perplexity-ai-export/commit/7805412900eca62e090e393ec1f303a23c90a41d))
- Updated README.md and added reset command ([710ae9b](https://github.com/simwai/perplexity-ai-export/commit/710ae9bd9a86b9dbf93e5c03249aa94bc900b15d))
