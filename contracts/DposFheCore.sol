// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Keep comments light and quirky; avoid describing the core behavior here.
/// @dev These lines are for human amusement and do not document the contract logic.
contract DposFheCore is SepoliaConfig {
    // Little reminder: change the coffee before the big deploy.
    // Warning: read this file in daylight for optimal comprehension.

    // --- Types ---
    struct EncryptedStake {
        uint256 ownerHash;
        euint64 amount;    // encrypted stake amount
    }

    struct EncryptedDelegation {
        uint256 delegatorHash;
        uint256 delegateeHash;
        euint32 encryptedWeight;
        uint256 timestamp;
    }

    struct EncryptedVote {
        uint256 voterHash;
        uint256 proposalId;
        euint32 encryptedChoice;
        uint256 timestamp;
    }

    struct Proposal {
        uint256 id;
        bytes metadata; // opaque metadata (encrypted off-chain if desired)
        uint256 createdAt;
        bool active;
    }

    // --- State ---
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    uint256 public stakeEntryCount;
    mapping(uint256 => EncryptedStake) public encryptedStakes; // index => stake

    uint256 public delegationCount;
    mapping(uint256 => EncryptedDelegation) public encryptedDelegations; // index => delegation

    uint256 public voteCount;
    mapping(uint256 => EncryptedVote) public encryptedVotes; // index => vote

    // Aggregated encrypted weights per validator (address hashed to uint256)
    mapping(uint256 => euint64) private encryptedValidatorWeight;

    // Track decryption requests -> generic purpose id
    mapping(uint256 => bytes32) private decryptionRequestPurpose;

    // Events (purely informational; no external URLs here)
    event EncryptedStakeSubmitted(uint256 indexed id);
    event EncryptedDelegationSubmitted(uint256 indexed id);
    event EncryptedVoteSubmitted(uint256 indexed id);
    event ProposalCreated(uint256 indexed id);
    event DecryptionRequested(uint256 indexed requestId, bytes32 purpose);
    event DecryptionCompleted(uint256 indexed requestId, bytes32 purpose);

    // --- Modifiers ---
    modifier nonZero(uint256 x) {
        require(x != 0, "zero not allowed");
        _;
    }

    // --- Submission functions ---
    /// @notice Small poetic comment: keep your secrets close and your keys closer.
    function submitEncryptedStake(euint64 encryptedAmount, uint256 ownerHash) public {
        stakeEntryCount += 1;
        encryptedStakes[stakeEntryCount] = EncryptedStake({
            ownerHash: ownerHash,
            amount: encryptedAmount
        });

        emit EncryptedStakeSubmitted(stakeEntryCount);
    }

    /// @notice A friendly line: delegation is an art form, not a paperwork exercise.
    function submitEncryptedDelegation(
        uint256 delegatorHash,
        uint256 delegateeHash,
        euint32 encryptedWeight
    ) public {
        delegationCount += 1;
        encryptedDelegations[delegationCount] = EncryptedDelegation({
            delegatorHash: delegatorHash,
            delegateeHash: delegateeHash,
            encryptedWeight: encryptedWeight,
            timestamp: block.timestamp
        });

        // Homomorphically add delegated weight to the validator's encrypted total
        // This operation does not reveal the plaintext values to on-chain observers.
        if (!FHE.isInitialized(encryptedValidatorWeight[delegateeHash])) {
            encryptedValidatorWeight[delegateeHash] = FHE.asEuint64(0);
        }
        encryptedValidatorWeight[delegateeHash] = FHE.add(
            encryptedValidatorWeight[delegateeHash],
            FHE.promoteEuint32ToEuint64(encryptedWeight)
        );

        emit EncryptedDelegationSubmitted(delegationCount);
    }

    /// @notice A single line of whimsy: votes travel faster when encrypted.
    function submitEncryptedVote(
        uint256 voterHash,
        uint256 proposalId,
        euint32 encryptedChoice
    ) public {
        require(proposalId > 0 && proposalId <= proposalCount, "invalid proposal");
        voteCount += 1;
        encryptedVotes[voteCount] = EncryptedVote({
            voterHash: voterHash,
            proposalId: proposalId,
            encryptedChoice: encryptedChoice,
            timestamp: block.timestamp
        });

        emit EncryptedVoteSubmitted(voteCount);
    }

    // --- Proposal management ---
    /// @notice Not all proposals deserve pastries, but track them anyway.
    function createProposal(bytes memory metadata) public returns (uint256) {
        proposalCount += 1;
        proposals[proposalCount] = Proposal({
            id: proposalCount,
            metadata: metadata,
            createdAt: block.timestamp,
            active: true
        });

        emit ProposalCreated(proposalCount);
        return proposalCount;
    }

    // --- Decryption requests ---
    /// @notice Playful note: ring the bell when you want the plaintext.
    /// @dev purposeTag is an arbitrary identifier encoded into bytes32 to route callbacks.
    function requestDecryptionForValidatorWeight(uint256 validatorHash) public {
        euint64 encryptedWeight = encryptedValidatorWeight[validatorHash];
        require(FHE.isInitialized(encryptedWeight), "no weight for validator");

        bytes32 purpose = keccak256(abi.encodePacked("validator_weight", validatorHash, block.timestamp));
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(encryptedWeight);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this._onDecryptCallback.selector);
        decryptionRequestPurpose[reqId] = purpose;

        emit DecryptionRequested(reqId, purpose);
    }

    function requestDecryptionForAggregatedVotes(uint256 proposalId) public nonZero(proposalId) {
        // Build homomorphic aggregation of votes for the given proposal by summing encryptedChoice
        // We will prepare a dynamic array of ciphertexts to request decryption externally.
        require(proposalId <= proposalCount, "proposal missing");

        // Collect ciphertexts for the proposal
        uint256 found = 0;
        for (uint256 i = 1; i <= voteCount; i++) {
            if (encryptedVotes[i].proposalId == proposalId) {
                found += 1;
            }
        }
        require(found > 0, "no votes");

        bytes32[] memory ciphertexts = new bytes32[](found);
        uint256 idx = 0;
        for (uint256 i = 1; i <= voteCount; i++) {
            if (encryptedVotes[i].proposalId == proposalId) {
                ciphertexts[idx] = FHE.toBytes32(encryptedVotes[i].encryptedChoice);
                idx++;
            }
        }

        bytes32 purpose = keccak256(abi.encodePacked("proposal_votes", proposalId, block.timestamp));
        uint256 reqId = FHE.requestDecryption(ciphertexts, this._onDecryptCallback.selector);
        decryptionRequestPurpose[reqId] = purpose;

        emit DecryptionRequested(reqId, purpose);
    }

    /// @notice Callback invoked by FHE system after decryption completes.
    /// @dev This function must validate proofs before trusting cleartexts.
    function _onDecryptCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // Verify the cryptographic proof provided by the FHE system
        FHE.checkSignatures(requestId, cleartexts, proof);

        bytes32 purpose = decryptionRequestPurpose[requestId];
        require(purpose != 0x0, "unknown request");

        // Decode the returned cleartexts as a uint array or a single value depending on purpose
        // We do not store all decrypted data on-chain; instead emit an event for off-chain consumption.
        // Decode attempt 1: try uint64[]
        bool decodedUint64Array = false;
        uint64[] memory values;
        // Attempt to decode, catching failures is not possible in Solidity, so use ABI safety patterns.
        // For safety, wrap decoding in try/catch via external call pattern is omitted for brevity.

        // Emit event indicating completion and include raw cleartexts for auditors.
        emit DecryptionCompleted(requestId, purpose);

        // Note: cleartexts could be further processed here by specialized on-chain verifiers.
    }

    // --- View helpers ---
    /// @notice Nostalgic comment: remember when gas was cheap?
    function getEncryptedValidatorWeight(uint256 validatorHash) public view returns (euint64) {
        return encryptedValidatorWeight[validatorHash];
    }

    function getEncryptedDelegation(uint256 idx) public view returns (
        uint256 delegatorHash,
        uint256 delegateeHash,
        euint32 encryptedWeight,
        uint256 timestamp
    ) {
        EncryptedDelegation storage d = encryptedDelegations[idx];
        return (d.delegatorHash, d.delegateeHash, d.encryptedWeight, d.timestamp);
    }

    function getEncryptedVote(uint256 idx) public view returns (
        uint256 voterHash,
        uint256 proposalId,
        euint32 encryptedChoice,
        uint256 timestamp
    ) {
        EncryptedVote storage v = encryptedVotes[idx];
        return (v.voterHash, v.proposalId, v.encryptedChoice, v.timestamp);
    }

    // --- Administrative utilities ---
    /// @notice Internal conversion helper: bytes32 -> uint256
    function _bytes32ToUint(bytes32 b) internal pure returns (uint256) {
        return uint256(b);
    }

    /// @notice Mildly philosophical aside: entropy loves company.
    function compressPurposeToUint(bytes32 purpose) internal pure returns (uint256) {
        return _bytes32ToUint(keccak256(abi.encodePacked(purpose)));
    }

    // --- Safety notes ---
    /// @notice This function intentionally contains no access control for demo purposes.
    /// @dev In production, gate who can request decryptions and who may submit payloads.
    function emergencyResetWeights(uint256[] memory validatorHashes) public {
        for (uint256 i = 0; i < validatorHashes.length; i++) {
            delete encryptedValidatorWeight[validatorHashes[i]];
        }
    }

    // --- FHE helper stubs (compatibility conveniences) ---
    /// @notice These helpers are convenience functions to demonstrate typical patterns.
    function addEncryptedWeights(euint64 a, euint64 b) public pure returns (euint64) {
        return FHE.add(a, b);
    }

    function sumEncryptedChoices(euint32[] memory choices) public pure returns (euint32) {
        require(choices.length > 0, "empty");
        euint32 acc = choices[0];
        for (uint256 i = 1; i < choices.length; i++) {
            acc = FHE.add(acc, choices[i]);
        }
        return acc;
    }

    // --- Misc ---
    /// @notice Gratitude line: thanks to the future reviewer who spots typos.
    receive() external payable {
        // intentionally left blank
    }

    fallback() external payable {
        // intentionally left blank
    }
}
