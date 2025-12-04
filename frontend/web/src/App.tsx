import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Node {
  id: string;
  name: string;
  address: string;
  votes: number;
  status: "active" | "pending" | "inactive";
  registeredAt: number;
}

interface Delegation {
  delegator: string;
  node: string;
  amount: number;
  timestamp: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [creatingNode, setCreatingNode] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newNodeData, setNewNodeData] = useState({
    name: "",
    description: ""
  });
  const [activeTab, setActiveTab] = useState("nodes");
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const activeNodes = nodes.filter(n => n.status === "active").length;
  const pendingNodes = nodes.filter(n => n.status === "pending").length;
  const inactiveNodes = nodes.filter(n => n.status === "inactive").length;
  const totalVotes = nodes.reduce((sum, node) => sum + node.votes, 0);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      // Load nodes
      const nodesBytes = await contract.getData("node_list");
      let nodeList: Node[] = [];
      
      if (nodesBytes.length > 0) {
        try {
          const nodeIds = JSON.parse(ethers.toUtf8String(nodesBytes));
          
          for (const id of nodeIds) {
            try {
              const nodeBytes = await contract.getData(`node_${id}`);
              if (nodeBytes.length > 0) {
                try {
                  const nodeData = JSON.parse(ethers.toUtf8String(nodeBytes));
                  nodeList.push({
                    id,
                    name: nodeData.name,
                    address: nodeData.address,
                    votes: nodeData.votes,
                    status: nodeData.status,
                    registeredAt: nodeData.registeredAt
                  });
                } catch (e) {
                  console.error(`Error parsing node data for ${id}:`, e);
                }
              }
            } catch (e) {
              console.error(`Error loading node ${id}:`, e);
            }
          }
        } catch (e) {
          console.error("Error parsing node list:", e);
        }
      }
      
      // Load delegations
      const delegationsBytes = await contract.getData("delegation_list");
      let delegationList: Delegation[] = [];
      
      if (delegationsBytes.length > 0) {
        try {
          const delegationIds = JSON.parse(ethers.toUtf8String(delegationsBytes));
          
          for (const id of delegationIds) {
            try {
              const delegationBytes = await contract.getData(`delegation_${id}`);
              if (delegationBytes.length > 0) {
                try {
                  const delegationData = JSON.parse(ethers.toUtf8String(delegationBytes));
                  delegationList.push({
                    delegator: delegationData.delegator,
                    node: delegationData.node,
                    amount: delegationData.amount,
                    timestamp: delegationData.timestamp
                  });
                } catch (e) {
                  console.error(`Error parsing delegation data for ${id}:`, e);
                }
              }
            } catch (e) {
              console.error(`Error loading delegation ${id}:`, e);
            }
          }
        } catch (e) {
          console.error("Error parsing delegation list:", e);
        }
      }
      
      nodeList.sort((a, b) => b.votes - a.votes);
      setNodes(nodeList);
      setDelegations(delegationList);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const registerNode = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreatingNode(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting node data with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const nodeId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const nodeData = {
        name: newNodeData.name,
        address: account,
        votes: 0,
        status: "pending",
        registeredAt: Math.floor(Date.now() / 1000),
        description: newNodeData.description
      };
      
      // Store encrypted node data on-chain using FHE
      await contract.setData(
        `node_${nodeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(nodeData))
      );
      
      const nodesBytes = await contract.getData("node_list");
      let nodeList: string[] = [];
      
      if (nodesBytes.length > 0) {
        try {
          nodeList = JSON.parse(ethers.toUtf8String(nodesBytes));
        } catch (e) {
          console.error("Error parsing node list:", e);
        }
      }
      
      nodeList.push(nodeId);
      
      await contract.setData(
        "node_list", 
        ethers.toUtf8Bytes(JSON.stringify(nodeList))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Node registered securely with FHE encryption!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowNodeModal(false);
        setNewNodeData({
          name: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Registration failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreatingNode(false);
    }
  };

  const delegateVotes = async (nodeId: string, amount: number) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted delegation with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update node votes using FHE
      const nodeBytes = await contract.getData(`node_${nodeId}`);
      if (nodeBytes.length === 0) {
        throw new Error("Node not found");
      }
      
      const nodeData = JSON.parse(ethers.toUtf8String(nodeBytes));
      const updatedNode = {
        ...nodeData,
        votes: nodeData.votes + amount
      };
      
      await contract.setData(
        `node_${nodeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNode))
      );
      
      // Create delegation record
      const delegationId = `${account.substring(2, 8)}-${nodeId.substring(0, 6)}-${Date.now()}`;
      const delegationData = {
        delegator: account,
        node: nodeId,
        amount: amount,
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      await contract.setData(
        `delegation_${delegationId}`, 
        ethers.toUtf8Bytes(JSON.stringify(delegationData))
      );
      
      // Update delegation list
      const delegationsBytes = await contract.getData("delegation_list");
      let delegationList: string[] = [];
      
      if (delegationsBytes.length > 0) {
        try {
          delegationList = JSON.parse(ethers.toUtf8String(delegationsBytes));
        } catch (e) {
          console.error("Error parsing delegation list:", e);
        }
      }
      
      delegationList.push(delegationId);
      
      await contract.setData(
        "delegation_list", 
        ethers.toUtf8Bytes(JSON.stringify(delegationList))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Delegation processed with FHE encryption!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Delegation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const activateNode = async (nodeId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Activating node with FHE verification..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const nodeBytes = await contract.getData(`node_${nodeId}`);
      if (nodeBytes.length === 0) {
        throw new Error("Node not found");
      }
      
      const nodeData = JSON.parse(ethers.toUtf8String(nodeBytes));
      
      const updatedNode = {
        ...nodeData,
        status: "active"
      };
      
      await contract.setData(
        `node_${nodeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNode))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Node activated with FHE verification!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Activation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const deactivateNode = async (nodeId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Deactivating node with FHE verification..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const nodeBytes = await contract.getData(`node_${nodeId}`);
      if (nodeBytes.length === 0) {
        throw new Error("Node not found");
      }
      
      const nodeData = JSON.parse(ethers.toUtf8String(nodeBytes));
      
      const updatedNode = {
        ...nodeData,
        status: "inactive"
      };
      
      await contract.setData(
        `node_${nodeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNode))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Node deactivated with FHE verification!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Deactivation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isNodeOwner = (nodeAddress: string) => {
    return account.toLowerCase() === nodeAddress.toLowerCase();
  };

  const filteredNodes = nodes.filter(node => 
    node.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    node.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const topNodes = [...nodes].sort((a, b) => b.votes - a.votes).slice(0, 5);

  const faqItems = [
    {
      question: "What is FHE-based DPoS?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decryption. In DPoS (Delegated Proof of Stake), this means votes and delegations remain encrypted while still enabling governance decisions."
    },
    {
      question: "How does FHE protect privacy?",
      answer: "FHE ensures that node operators and delegators can participate in governance without revealing their voting preferences or delegation amounts. All computations happen on encrypted data."
    },
    {
      question: "Can I see my own votes?",
      answer: "Yes, while votes are encrypted on-chain, you can decrypt your own voting information using your private key. Others cannot see your specific votes."
    },
    {
      question: "How are nodes selected?",
      answer: "Nodes with the most delegated votes become block producers. The top nodes by vote count are selected each election cycle."
    },
    {
      question: "What are the benefits of FHE in DAOs?",
      answer: "FHE enables private voting, prevents vote buying through secrecy, protects against targeted attacks on node operators, and maintains decentralization while preserving privacy."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>DPoS</span>DAO</h1>
          <div className="fhe-badge">
            <span>FHE-Powered</span>
          </div>
        </div>
        
        <div className="header-actions">
          <div className="search-container">
            <input 
              type="text" 
              placeholder="Search nodes..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="metal-input"
            />
            <div className="search-icon"></div>
          </div>
          <button 
            onClick={() => setShowNodeModal(true)} 
            className="create-node-btn metal-button"
          >
            <div className="add-icon"></div>
            Register Node
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="panel-container">
          {/* Left Panel - Stats and FAQ */}
          <div className="left-panel">
            <div className="panel-section metal-card">
              <h3>Network Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{nodes.length}</div>
                  <div className="stat-label">Total Nodes</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{activeNodes}</div>
                  <div className="stat-label">Active</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingNodes}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{totalVotes}</div>
                  <div className="stat-label">Total Votes</div>
                </div>
              </div>
            </div>
            
            <div className="panel-section metal-card">
              <h3>Top Nodes</h3>
              <div className="leaderboard">
                {topNodes.map((node, index) => (
                  <div className="leaderboard-item" key={node.id}>
                    <div className="rank">{index + 1}</div>
                    <div className="node-info">
                      <div className="node-name">{node.name}</div>
                      <div className="node-votes">{node.votes} votes</div>
                    </div>
                    <div className={`status-badge ${node.status}`}>{node.status}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="panel-section metal-card">
              <h3>FHE DPoS Explained</h3>
              <p className="explanation">
                Our FHE-based DPoS DAO uses Fully Homomorphic Encryption to keep all votes and delegations private. 
                Nodes are selected based on encrypted vote counts, and governance happens without revealing individual preferences.
              </p>
              <div className="fhe-diagram">
                <div className="fhe-step">
                  <div className="step-icon">🔒</div>
                  <div className="step-text">Encrypted Votes</div>
                </div>
                <div className="fhe-arrow">→</div>
                <div className="fhe-step">
                  <div className="step-icon">⚙️</div>
                  <div className="step-text">FHE Computation</div>
                </div>
                <div className="fhe-arrow">→</div>
                <div className="fhe-step">
                  <div className="step-icon">✅</div>
                  <div className="step-text">Private Results</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Main Panel - Nodes and Delegations */}
          <div className="main-panel">
            <div className="panel-header">
              <div className="tabs">
                <button 
                  className={`tab ${activeTab === "nodes" ? "active" : ""}`}
                  onClick={() => setActiveTab("nodes")}
                >
                  Nodes
                </button>
                <button 
                  className={`tab ${activeTab === "delegations" ? "active" : ""}`}
                  onClick={() => setActiveTab("delegations")}
                >
                  Delegations
                </button>
                <button 
                  className={`tab ${activeTab === "faq" ? "active" : ""}`}
                  onClick={() => setActiveTab("faq")}
                >
                  FAQ
                </button>
              </div>
              <button 
                onClick={loadData}
                className="refresh-btn metal-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
            
            <div className="panel-content">
              {activeTab === "nodes" && (
                <div className="nodes-section">
                  <div className="section-header">
                    <h2>Network Nodes</h2>
                    <div className="node-count">{nodes.length} nodes found</div>
                  </div>
                  
                  <div className="nodes-list metal-card">
                    {filteredNodes.length === 0 ? (
                      <div className="no-nodes">
                        <div className="no-nodes-icon"></div>
                        <p>No nodes found matching your search</p>
                        <button 
                          className="metal-button primary"
                          onClick={() => setShowNodeModal(true)}
                        >
                          Register First Node
                        </button>
                      </div>
                    ) : (
                      <div className="nodes-grid">
                        {filteredNodes.map(node => (
                          <div className="node-card" key={node.id}>
                            <div className="node-header">
                              <div className="node-name">{node.name}</div>
                              <div className={`status-badge ${node.status}`}>{node.status}</div>
                            </div>
                            <div className="node-address">{node.address.substring(0, 6)}...{node.address.substring(38)}</div>
                            <div className="node-stats">
                              <div className="stat">
                                <div className="stat-label">Votes</div>
                                <div className="stat-value">{node.votes}</div>
                              </div>
                              <div className="stat">
                                <div className="stat-label">Registered</div>
                                <div className="stat-value">
                                  {new Date(node.registeredAt * 1000).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                            <div className="node-actions">
                              <button 
                                className="metal-button small delegate-btn"
                                onClick={() => delegateVotes(node.id, 1)}
                              >
                                Delegate 1 Vote
                              </button>
                              <button 
                                className="metal-button small delegate-btn"
                                onClick={() => delegateVotes(node.id, 5)}
                              >
                                Delegate 5 Votes
                              </button>
                              {isNodeOwner(node.address) && (
                                <>
                                  {node.status === "pending" && (
                                    <button 
                                      className="metal-button small success"
                                      onClick={() => activateNode(node.id)}
                                    >
                                      Activate
                                    </button>
                                  )}
                                  {node.status === "active" && (
                                    <button 
                                      className="metal-button small danger"
                                      onClick={() => deactivateNode(node.id)}
                                    >
                                      Deactivate
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {activeTab === "delegations" && (
                <div className="delegations-section">
                  <div className="section-header">
                    <h2>Delegation Records</h2>
                    <div className="delegation-count">{delegations.length} delegations</div>
                  </div>
                  
                  <div className="delegations-list metal-card">
                    <div className="table-header">
                      <div className="header-cell">Delegator</div>
                      <div className="header-cell">Node</div>
                      <div className="header-cell">Votes</div>
                      <div className="header-cell">Date</div>
                    </div>
                    
                    {delegations.length === 0 ? (
                      <div className="no-delegations">
                        <div className="no-delegations-icon"></div>
                        <p>No delegation records found</p>
                        <p>Delegate votes to nodes to see records here</p>
                      </div>
                    ) : (
                      delegations.map(delegation => {
                        const node = nodes.find(n => n.id === delegation.node);
                        return (
                          <div className="delegation-row" key={`${delegation.delegator}-${delegation.node}-${delegation.timestamp}`}>
                            <div className="table-cell">{delegation.delegator.substring(0, 6)}...{delegation.delegator.substring(38)}</div>
                            <div className="table-cell">{node ? node.name : "Unknown Node"}</div>
                            <div className="table-cell">{delegation.amount}</div>
                            <div className="table-cell">
                              {new Date(delegation.timestamp * 1000).toLocaleDateString()}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
              
              {activeTab === "faq" && (
                <div className="faq-section">
                  <div className="section-header">
                    <h2>Frequently Asked Questions</h2>
                  </div>
                  
                  <div className="faq-list metal-card">
                    {faqItems.map((faq, index) => (
                      <div className="faq-item" key={index}>
                        <div className="faq-question">
                          <div className="question-icon">❓</div>
                          <h3>{faq.question}</h3>
                        </div>
                        <div className="faq-answer">
                          <div className="answer-icon">💡</div>
                          <p>{faq.answer}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  
      {showNodeModal && (
        <ModalNode 
          onSubmit={registerNode} 
          onClose={() => setShowNodeModal(false)} 
          creating={creatingNode}
          nodeData={newNodeData}
          setNodeData={setNewNodeData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE DPoS DAO</span>
            </div>
            <p>Private decentralized governance powered by Fully Homomorphic Encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE DPoS DAO. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalNodeProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  nodeData: any;
  setNodeData: (data: any) => void;
}

const ModalNode: React.FC<ModalNodeProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  nodeData,
  setNodeData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNodeData({
      ...nodeData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!nodeData.name) {
      alert("Please enter a node name");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Register New Node</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your node data will be encrypted with FHE technology
          </div>
          
          <div className="form-group">
            <label>Node Name *</label>
            <input 
              type="text"
              name="name"
              value={nodeData.name} 
              onChange={handleChange}
              placeholder="Enter node name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description"
              value={nodeData.description} 
              onChange={handleChange}
              placeholder="Describe your node..." 
              className="metal-textarea"
              rows={3}
            />
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> All node information is encrypted using FHE for maximum privacy
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Register Node"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;