# Test archive sources

`zkn3-sample.zkn3` and `zkn3-tricky.zkn3` are unchanged public test archives from Zettelkasten-Team/Zettelkasten. These two files use the upstream GNU GPL version 3 license. See `ZETTELKASTEN-LICENSE`. They are test data. The plugin bundle does not contain them or program code from that project.

| File | Upstream file | SHA-256 |
|---|---|---|
| `zkn3-sample.zkn3` | [zkn3_sample.zkn3](https://github.com/Zettelkasten-Team/Zettelkasten/blob/main/src/test/resources/zkn3_sample.zkn3) | `a8b65ad370ab76202079af191939b196b25a2eba6503759ce8e373a701a545bc` |
| `zkn3-tricky.zkn3` | [zkn3_tricky.zkn3](https://github.com/Zettelkasten-Team/Zettelkasten/blob/main/src/test/resources/zkn3_tricky.zkn3) | `a6e8fe236dd4a784875bec777e0207e8cf585770e4931a3c733aa865fbb2cec3` |

`zkn3-deleted-slot.zkn3` is the synthetic edge case from the local research fixture set. Its SHA-256 is `4342fd765edefc63f031b3c4b909898ae2db5355cde0e2741d6c3de38badf8c0`. It has live positions 1 and 3, a deleted position 2, and the exact keywords `two words` and `two-words`.

The other archives are synthetic test data made by `zkn3.mjs`. They use the MIT license of this plugin.
