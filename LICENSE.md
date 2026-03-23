# License

Copyright (c) 2025–present Code Lama Software

## Noncommercial Use

This software is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).

You may use, copy, modify, and distribute this software for any **noncommercial** purpose. This includes personal projects, academic research, education, and evaluation.

## Commercial Use (v1.0, March 2026)

Any commercial use of this software requires an active [GitHub Sponsors](https://github.com/sponsors/lamalibre) subscription at the tier matching your organization's gross annual revenue. A single sponsorship covers all repositories under the [lamalibre](https://github.com/lamalibre) organization.

Licensing is **per-organization, not per-seat** — one subscription covers your entire team.

Commercial use includes, but is not limited to:

- Using the software to support business operations, whether client-facing or internal
- Deploying the software as part of a revenue-generating service or product
- Using the software internally at a for-profit organization

### Sponsorship Tiers

| Tier | Annual Revenue | Price |
|---|---|---|
| **Starter** | Up to $100K | $5/month |
| **Team** | $100K – $500K | $25/month |
| **Growth** | $500K – $1M | $50/month |
| **Scale** | $1M – $3M | $75/month |
| **Business** | $3M – $5M | $100/month |
| **Enterprise** | $5M+ | [Contact us](mailto:license@codelama.com.tr) |

Every tier costs less than a single hour of developer time. If our software saves your team time and resources, a sponsorship is the fair way to support its continued development.

**"Annual revenue"** means the gross annual revenue of the legal entity using the software. If the using entity is a subsidiary, the revenue of the parent organization applies.

Your organization is responsible for selecting the tier that matches its annual revenue. Selecting a tier that does not correspond to your organization's actual annual revenue constitutes a violation of these terms.

### Commercial License Grant

Once you become an active sponsor at the qualifying tier, you are granted all rights described in the [PolyForm Noncommercial License 1.0.0](#polyform-noncommercial-license-100) below, **with the noncommercial restriction waived**, for **all lamalibre repositories** for the duration of your sponsorship. The license is per-organization, not per-seat. All other terms and conditions of the PolyForm Noncommercial License — including the prohibition on sublicensing — remain in full effect.

If your sponsorship lapses, your commercial use license ends at the close of the last paid billing period. You may continue noncommercial use under the PolyForm Noncommercial License at any time.

### Contributions

By submitting a pull request or any other contribution to a lamalibre repository, you agree that your contribution is licensed under the same terms as this license.

## Questions

If you are unsure whether your use qualifies as noncommercial, please open a [GitHub Discussion](https://github.com/lamalibre/shell/discussions) or contact us at license@codelama.com.tr.

---

## Polyform Noncommercial License 1.0.0

<https://polyformproject.org/licenses/noncommercial/1.0.0/>

### Acceptance

In order to get any license under these terms, you must agree to them as both strict obligations and conditions to all your licenses.

### Copyright License

The licensor grants you a copyright license for the software to do everything you might do with the software that would otherwise infringe the licensor's copyright in it for any permitted purpose. However, you may only distribute the software according to [Distribution License](#distribution-license) and make changes or new works based on the software according to [Changes and New Works License](#changes-and-new-works-license).

### Distribution License

The licensor grants you an additional copyright license to distribute copies of the software. Your license to distribute covers distributing the software with changes and new works permitted by [Changes and New Works License](#changes-and-new-works-license).

### Notices

You must ensure that anyone who gets a copy of any part of the software from you also gets a copy of these terms or the URL for them above, as well as copies of any plain-text lines beginning with `Required Notice:` that the licensor provided with the software. For example:

> Required Notice: Copyright (c) 2025–present Code Lama Software (https://github.com/lamalibre)

### Changes and New Works License

The licensor grants you an additional copyright license to make changes and new works based on the software for any permitted purpose.

### Patent License

The licensor grants you a patent license for the software that covers patent claims the licensor can license, or becomes able to license, that you would infringe by using the software.

### Noncommercial Purposes

Any noncommercial purpose is a permitted purpose.

### Personal Uses

Personal use for research, experiment, and testing for the benefit of public knowledge, personal study, private entertainment, hobby projects, amateur pursuits, or religious observance, without any anticipated commercial application, is use for a permitted purpose.

### Noncommercial Organizations

Use by any charitable organization, educational institution, public research organization, public safety or health organization, environmental protection organization, or government institution is use for a permitted purpose regardless of the source of funding or obligations resulting from the funding.

### Fair Use

You may have "fair use" rights for the software under the law. These terms do not limit them.

### No Other Rights

These terms do not allow you to sublicense or transfer any of your licenses to anyone else, or prevent the licensor from granting licenses to anyone else. These terms do not imply any other licenses.

### Patent Defense

If you make any written claim that the software infringes or contributes to infringement of any patent, your patent license for the software granted under these terms ends immediately. If your company makes such a claim, your patent license ends immediately for work on behalf of your company.

### Violations

The first time you are notified in writing that you have violated any of these terms, or any agreement made under them, you have 32 calendar days to come into compliance. If you come into compliance within that time, your licenses under these terms will not be permanently revoked.

### No Liability

**_As far as the law allows, the software comes as is, without any warranty or condition, and the licensor will not be liable to you for any damages arising out of these terms or the use or nature of the software, under any kind of legal claim._**

### Definitions

The **licensor** is the individual or entity offering these terms, and the **software** is the software the licensor makes available under these terms.

**You** refers to the individual or entity agreeing to these terms.

**Your company** is any legal entity, sole proprietorship, or other kind of organization that you work for, plus all organizations that have control over, are under the control of, or are under common control with that organization. **Control** means ownership of substantially all the assets of an entity, or the power to direct its management and policies by vote, contract, or otherwise. Control can be direct or indirect.

**Your licenses** are all the licenses granted to you for the software under these terms.

**Use** means anything you do with the software requiring one of your licenses.

---

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Shell is designed for secure remote terminal access — personal projects, development environments, and internal tools. It is not a substitute for production infrastructure without proper security review.

**You are solely responsible for what you expose through Shell.** By enabling remote terminal access, you grant anyone with valid credentials the ability to interact with your system. This carries inherent risks:

- **Arbitrary code execution:** If the agent or server is misconfigured, remote attackers may exploit access to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured policies or weak authentication may leak sensitive data, credentials, or private files.
- **Lateral movement:** A compromised terminal session may be used as an entry point to attack other devices and services on your network.
- **Resource abuse:** Improperly secured access may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Shell provides mTLS authentication, time-window policies, IP ACLs, and session recording, but no security measure is absolute. It is your responsibility to understand the systems you expose, keep them updated, and assess the risks of enabling remote access. The authors of Shell bear no responsibility for the consequences of misconfigured or insecure deployments.
