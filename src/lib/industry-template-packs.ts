export interface IndustryTemplatePack {
  industryCode: string;
  industryName: string;
  description: string;
  primaryMissionObjective: string;
  commonAssetClasses: string[];
  onboardingQuestions: string[];
  criticalityModel: {
    riskMatrix: string;
    consequenceCategories: string[];
    likelihoodScale: string;
    criticalityThresholds: { low: number; medium: number; high: number; critical: number };
  };
  riskDrivers: string[];
  safeguards: string[];
  approvalGates: string[];
  failureModeFocusAreas: string[];
  kpiModel: {
    primaryKpis: string[];
    secondaryKpis: string[];
    kpiTargets: Record<string, string>;
  };
  readinessModel: {
    readinessLevels: string[];
    minimumForOperation: string;
    minimumForOptimization: string;
  };
  regulatoryConsiderations: string[];
  dataSourcesRequired: string[];
  integrationTargets: string[];
  outputArtifacts: string[];
  confidenceRules: string[];
  blockedAutomationRules: string[];
  templateVersion: string;
  validationStatus: 'draft' | 'reviewed' | 'customer_validated' | 'deprecated';
}

export const INDUSTRY_TEMPLATE_PACKS: Record<string, IndustryTemplatePack> = {
  oil_sands: {
    industryCode: 'oil_sands',
    industryName: 'Oil Sands',
    description: 'Bitumen extraction operations including SAGD (Steam-Assisted Gravity Drainage), surface mining, and upgrading facilities with emphasis on environmental stewardship, abrasive service management, winterization, and tailings pond integrity.',
    primaryMissionObjective: 'Maximize bitumen production while maintaining environmental compliance, equipment reliability, and safe operations in extreme climate conditions.',
    commonAssetClasses: [
      'SAGD Steam Generators',
      'Horizontal Wellbores',
      'Extraction Equipment',
      'Upgrader Reactors',
      'Tailings Management Systems',
      'Pipeline Networks',
      'Compressors and Turbines',
      'Water Treatment Plants'
    ],
    onboardingQuestions: [
      'What is your primary recovery method - primary depletion, SAGD, CSS, or hybrid?',
      'What is your current bitumen production capacity (barrels per day)?',
      'How many active wellpairs or extraction pads do you operate?',
      'What is your tailings management strategy - thickened tailings, CT, or hybrid?',
      'What are your winter operational constraints and heating requirements?',
      'Do you have an upgrader facility or sell dilbit/synbit to third-party upgraders?',
      'What is your current produced water disposal capacity?',
      'How many critical environmental compliance monitoring points do you maintain?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Environmental-Health-Safety-Production Matrix',
      consequenceCategories: [
        'Regulatory Non-Compliance',
        'Environmental Release',
        'Personnel Safety Incident',
        'Production Loss',
        'Reputational Damage'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 3, medium: 6, high: 12, critical: 16 }
    },
    riskDrivers: [
      'Abrasive particle erosion in pipelines and equipment',
      'Steam system pressure excursions and safety-critical valve failures',
      'Wellbore integrity loss and uncontrolled emissions',
      'Tailings pond seepage and groundwater contamination',
      'Extreme weather events and freeze protection failures',
      'Corrosion under insulation in hydrogen sulfide service'
    ],
    safeguards: [
      'Automated steam drum level control with dual redundant instrumentation',
      'Real-time wellbore pressure monitoring with automated shut-in protocols',
      'Quarterly tailings geotechnical assessments and seepage monitoring',
      'Seasonal winterization inspections and trace heating verification',
      'Automated pipeline pig runs for debris removal',
      'Pressure relief valve functional testing on 18-month intervals'
    ],
    approvalGates: [
      'Well Drilling and Completion - Geological and Engineering Review',
      'Facility Modification - Safety and Environmental Impact Assessment',
      'Tailings Management Plan Update - Regulatory and Geotechnical Sign-off',
      'Winter Readiness Certification - Operations and Weather Services Review',
      'New Equipment Installation - Mechanical Integrity and PSM Review'
    ],
    failureModeFocusAreas: [
      'Steam generator tube ruptures and water carryover',
      'Horizontal wellbore blockage from asphaltene precipitation',
      'Tailings pond dam breach or liquefaction',
      'Casing corrosion and wellbore abandonment failures',
      'Compressor bearing degradation from emulsion ingestion',
      'Heat exchanger fouling and performance degradation',
      'Control system failures resulting in production shutdown'
    ],
    kpiModel: {
      primaryKpis: [
        'Bitumen Production Rate (bbl/day)',
        'Equipment Availability (% uptime)',
        'Environmental Compliance Score (%)',
        'Personnel Safety Incident Rate (TRIFR)',
        'Steam to Oil Ratio (SOR)',
        'Tailings Inventory Volume (% capacity)',
        'Wellbore Integrity Index'
      ],
      secondaryKpis: [
        'Water Consumption per Barrel Produced',
        'Produced Water Recycling Rate (%)',
        'Pipeline Inspection Coverage (%)',
        'Preventive Maintenance Compliance (%)',
        'Regulatory Inspection Findings (count)',
        'Energy Efficiency Index'
      ],
      kpiTargets: {
        'Equipment Availability': '92-96%',
        'Environmental Compliance Score': '98%+',
        'TRIFR': '<1.0',
        'Steam to Oil Ratio': '2.5-3.5'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual monitoring, reactive repairs',
        'Managed - Scheduled maintenance, basic monitoring',
        'Optimized - Predictive analytics, automated controls',
        'Autonomous - Self-healing systems, AI-driven optimization'
      ],
      minimumForOperation: 'Managed - Scheduled maintenance program with quarterly inspections',
      minimumForOptimization: 'Optimized - Predictive maintenance with integrated sensor networks'
    },
    regulatoryConsiderations: [
      'Provincial Energy Regulator approval for facility modifications',
      'Canadian Environmental Protection Act compliance for emissions',
      'Tailings Management Frameworks and geometechnical standards',
      'Workplace Health and Safety legislation and incident reporting',
      'Water Act permits and discharge monitoring',
      'Indigenous consultation and consultation records maintenance'
    ],
    dataSourcesRequired: [
      'SCADA system data (pressures, temperatures, flow rates)',
      'Well production data and pressure surveys',
      'Tailings pond monitoring (seepage, compaction, pore pressure)',
      'Environmental monitoring (air quality, water quality, wildlife)',
      'Maintenance and inspection records (MIS/CMMS)',
      'Weather and climate data'
    ],
    integrationTargets: [
      'Operational SCADA systems',
      'Well production databases',
      'Tailings management information systems',
      'Environmental compliance tracking systems',
      'SAP or Oracle ERP for maintenance records',
      'Real-time GIS mapping for environmental monitoring'
    ],
    outputArtifacts: [
      'Monthly Equipment Availability Dashboard',
      'Quarterly Wellbore Integrity Report',
      'Tailings Management Compliance Certificate',
      'Annual Risk Assessment and Mitigation Plan',
      'Equipment Criticality and Maintenance Schedule',
      'Environmental Compliance Scorecard',
      'Predictive Maintenance Recommendations Report'
    ],
    confidenceRules: [
      'Production data must have <5% missing intervals',
      'Pressure readings require dual sensor confirmation for critical thresholds',
      'Wellbore assessments require wireline logs or pressure transient analysis',
      'Tailings data must include independent third-party verification quarterly',
      'Environmental data requires certified laboratory analysis',
      'Incident data must be cross-referenced with regulatory filings'
    ],
    blockedAutomationRules: [
      'Do not auto-adjust steam generation setpoints - requires manual operator intervention',
      'Do not auto-shut-in wells based on single sensor reading - requires manual verification',
      'Do not modify wellbore pressure relief settings without engineer sign-off',
      'Do not auto-approve tailings management plan changes',
      'Do not automatically restart facility after safety system activation',
      'Do not modify environmental permit compliance limits'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  mining: {
    industryCode: 'mining',
    industryName: 'Mining',
    description: 'Open pit and underground mining operations including mineral processing, ore handling, and beneficiation with emphasis on production throughput, dust control, mobile fleet reliability, and personnel safety in hazardous environments.',
    primaryMissionObjective: 'Extract mineral ore at maximum sustainable throughput while maintaining safety, environmental compliance, and equipment reliability in challenging geological conditions.',
    commonAssetClasses: [
      'Shovel and Excavator Fleet',
      'Haul Trucks and Mobile Equipment',
      'Primary Crushers and Comminution Mills',
      'Conveyor Belt Systems',
      'Flotation and Separation Equipment',
      'Concentrator Plants',
      'Ventilation Systems (underground)',
      'Pump and Dewatering Systems'
    ],
    onboardingQuestions: [
      'Is your operation open pit, underground, or mixed mining?',
      'What ore types do you process and what are their hardness indices?',
      'What is your current total ore processing capacity (tonnes per day)?',
      'How many mobile units are in your primary fleet and what is their age profile?',
      'What are your mine waste and tailings production volumes?',
      'Do you operate a concentrator or undertake on-site beneficiation?',
      'What are your primary dust and noise management challenges?',
      'What is your current equipment utilization rate across the fleet?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Safety-Production-Environmental Impact Matrix',
      consequenceCategories: [
        'Lost Time Injury or Fatality',
        'Production Stoppage',
        'Environmental Violation',
        'Regulatory Non-Compliance',
        'Equipment Loss'
      ],
      likelihoodScale: 'Rare-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 15 }
    },
    riskDrivers: [
      'Mobile equipment rollover, collision, or entrapment hazards',
      'Comminution equipment bearing and motor failures',
      'Conveyor belt ruptures and spillage',
      'Tailings dam stability and seepage',
      'Dust inhalation and occupational health exposure',
      'Operator fatigue and visibility in haul roads'
    ],
    safeguards: [
      'Automated proximity detection and collision avoidance on mobile equipment',
      'Condition monitoring on mill drive motors and gearboxes',
      'Automated belt alignment and tension monitoring systems',
      'Real-time tailings dam pore pressure and seepage monitoring',
      'Continuous dust monitoring with automated water suppression',
      'Fatigue detection systems and mandatory rest break protocols'
    ],
    approvalGates: [
      'Mine Plan Approval - Geological and Permitting Review',
      'Equipment Addition - Safety and Maintenance Capability Assessment',
      'Production Rate Increase - Geotechnical and Environmental Impact Review',
      'Tailings Management Plan Update - Engineering and Regulatory Sign-off',
      'New Processing Method - Operational and Environmental Approval'
    ],
    failureModeFocusAreas: [
      'Truck transmission and drivetrain overheating under load',
      'Mill bearing seizure from inadequate lubrication',
      'Conveyor belt tracking misalignment and lateral discharge',
      'Shovel bucket tooth wear and excavator arm fatigue cracks',
      'Dust scrubber system clogging and pressure drop',
      'Tailings thickener underflow line blockage',
      'Ventilation fan motor bearing degradation in underground mines'
    ],
    kpiModel: {
      primaryKpis: [
        'Ore Production Rate (tonnes/day)',
        'Mobile Equipment Availability (%)',
        'Comminution Plant Uptime (%)',
        'Lost Time Injury Frequency Rate (LTIFR)',
        'Dust Concentration (mg/m³)',
        'Concentrate Grade (%)',
        'Mine Waste Produced (tonnes)'
      ],
      secondaryKpis: [
        'Fleet Utilization Rate (%)',
        'Conveyor System Downtime (hours)',
        'Tailings Throughput (tonnes/day)',
        'Energy Consumption per Tonne',
        'Water Consumption and Recycling (%)',
        'Regulatory Inspection Findings'
      ],
      kpiTargets: {
        'Equipment Availability': '85-92%',
        'LTIFR': '<0.5',
        'Dust Concentration': '<2 mg/m³',
        'Concentrate Grade': 'Geological-dependent targets'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Reactive maintenance, minimal monitoring',
        'Managed - Scheduled maintenance, basic equipment tracking',
        'Optimized - Predictive analytics, integrated fleet management',
        'Autonomous - Self-driving equipment, autonomous optimization'
      ],
      minimumForOperation: 'Managed - Preventive maintenance schedule with weekly inspections',
      minimumForOptimization: 'Optimized - Real-time fleet telematics with predictive diagnostics'
    },
    regulatoryConsiderations: [
      'Mining Act permits and annual compliance reporting',
      'Occupational Health and Safety regulations and inspections',
      'Environmental permitting for tailings and waste management',
      'Tailings dam safety legislation and geotechnical assessment',
      'Dust and air quality emissions standards',
      'Water usage and discharge permits'
    ],
    dataSourcesRequired: [
      'Mobile equipment telematics (GPS, fuel consumption, engine diagnostics)',
      'SCADA data from processing plants',
      'Maintenance records and equipment logs',
      'Tailings dam monitoring (pore pressure, settlement, seepage)',
      'Environmental monitoring (dust, air quality, water)',
      'Production and grade assay data',
      'Weather and climate records'
    ],
    integrationTargets: [
      'Fleet telematics and dispatch systems',
      'Comminution plant SCADA',
      'Tailings management systems',
      'Environmental monitoring networks',
      'CMMS and maintenance planning systems',
      'Production accounting and grade control systems'
    ],
    outputArtifacts: [
      'Daily Production Dashboard (tonnes, grade, downtime)',
      'Weekly Fleet Availability Report',
      'Monthly Equipment Criticality Assessment',
      'Quarterly Tailings Dam Safety Certificate',
      'Annual Environmental Compliance Report',
      'Predictive Maintenance Schedule (3-month forward)',
      'Safety Incident Analysis and Trend Report'
    ],
    confidenceRules: [
      'Production data must align with shift reports and weigh scales',
      'Equipment telematics data requires minimum 95% coverage per unit',
      'Tailings dam data must include certified geotechnical engineer review',
      'Environmental samples require certified laboratory analysis',
      'Maintenance records must include actual work completion dates',
      'Production grade data must be cross-referenced with assay certificates'
    ],
    blockedAutomationRules: [
      'Do not auto-adjust haul routes based solely on fuel efficiency',
      'Do not auto-increase mill throughput beyond nameplate capacity',
      'Do not auto-shut down tailings thickener without operator review',
      'Do not modify environmental compliance thresholds automatically',
      'Do not auto-override proximity detection systems',
      'Do not automatically increase dust suppression to maximum levels'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  oil_gas: {
    industryCode: 'oil_gas',
    industryName: 'Oil & Gas',
    description: 'Upstream, midstream, and downstream petroleum operations including wellhead production, pipeline transportation, and processing with emphasis on integrity management, process safety, and PSM (Process Safety Management) compliance.',
    primaryMissionObjective: 'Safely and reliably produce, transport, and process hydrocarbons while maintaining regulatory compliance and operational integrity across all pressure boundaries.',
    commonAssetClasses: [
      'Producing Wellheads and Downhole Equipment',
      'Pipeline Networks and Compression',
      'Processing Facilities and Separators',
      'Pump and Compressor Stations',
      'Storage Tanks and Vessels',
      'Valves and Pressure Control',
      'Instrumentation and Control Systems',
      'Dehydration and Treatment Equipment'
    ],
    onboardingQuestions: [
      'What is your primary business segment - upstream, midstream, downstream, or integrated?',
      'What is your total pipeline network extent and operating pressures?',
      'How many producing wellheads or production facilities do you operate?',
      'What are your current hydrocarbon volumes processed or transported?',
      'What are your pressure boundaries and process fluid hazards?',
      'Do you operate asset integrity management programs for pipelines?',
      'What is your regulatory jurisdiction and PSM compliance status?',
      'How many compression or pumping stations are in your network?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Safety-Environmental-Regulatory-Production Impact',
      consequenceCategories: [
        'Personnel Injury or Fatality',
        'Environmental Release',
        'Regulatory Non-Compliance',
        'Production Loss',
        'Major Incident'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 3, medium: 8, high: 15, critical: 20 }
    },
    riskDrivers: [
      'Pipeline corrosion and integrity loss from internal erosion',
      'Pressure relief valve stiction and failure to open',
      'Pump seal failure and mechanical cavitation',
      'Compressor bearing degradation and catastrophic seizure',
      'Control system malfunction and process excursions',
      'Hydrocarbon release from connector leaks or coupling failure'
    ],
    safeguards: [
      'Automated pressure relief system with dual redundant valve trains',
      'Pipeline intelligent pig inspection program with annual coverage',
      'Real-time pressure and temperature monitoring at critical nodes',
      'Compressor condition monitoring with oil analysis every 500 hours',
      'Process safety system with automated shutdown on parameter deviation',
      'Emergency isolation and emergency depressuring procedures'
    ],
    approvalGates: [
      'Facility Design - Pressure System and Safety Review',
      'Pressure Equipment Modification - Engineering and PSM Review',
      'Process Parameter Change - Risk Assessment and MOC Approval',
      'Pipeline Route or Segment Addition - Integrity and Regulatory Sign-off',
      'Safety System Modification - Functional Safety Review and SIL Assessment'
    ],
    failureModeFocusAreas: [
      'Pipeline internal corrosion and pitting under wet gas conditions',
      'Pump cavitation and impeller erosion from low suction pressure',
      'Compressor surge and mechanical failure from inlet pressure variations',
      'Separator internals erosion from entrained sand or solids',
      'Valve seat wear and loss of sealing from erosive flow',
      'Instrumentation sensor drift and false readings',
      'Connector coupling galling and thread stripping'
    ],
    kpiModel: {
      primaryKpis: [
        'Hydrocarbon Production Rate (bbl/d or MMcf/d)',
        'Pipeline Availability (%)',
        'Process Safety System Availability (%)',
        'Pipeline Inspection Coverage (%)',
        'Environmental Release Incidents (count)',
        'Asset Integrity Index',
        'Pressure Relief Valve Test Success Rate (%)'
      ],
      secondaryKpis: [
        'Equipment Availability (%)',
        'Process Uptime (%)',
        'Regulatory Inspection Findings',
        'Maintenance Compliance (%)',
        'Preventive Maintenance Interval Adherence'
      ],
      kpiTargets: {
        'Pipeline Availability': '98%+',
        'Process Safety System Availability': '99%+',
        'Environmental Incidents': '0',
        'Asset Integrity Index': '>92'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual inspection, reactive repairs',
        'Managed - Scheduled inspection and maintenance',
        'Optimized - Predictive integrity management with analytics',
        'Autonomous - Autonomous systems with continuous optimization'
      ],
      minimumForOperation: 'Managed - Annual pipeline inspection, quarterly equipment verification',
      minimumForOptimization: 'Optimized - Continuous monitoring with real-time analytics'
    },
    regulatoryConsiderations: [
      'ANSI/ASME B31.8 (Pipeline Systems) standards compliance',
      'Process Safety Management (PSM) / Seveso Directive requirements',
      'API 1104 (Pipeline Welding) and API 570 (Piping Inspection)',
      'Pressure Equipment Directive (PED) compliance',
      'Environmental permitting and spill prevention control',
      'Mechanical Integrity inspection and testing programs'
    ],
    dataSourcesRequired: [
      'SCADA system data (pressures, temperatures, flow rates, alarms)',
      'Pipeline intelligent pig inspection results',
      'Maintenance records and equipment service logs',
      'Pressure test and relief valve functional test data',
      'Process upset and incident event logs',
      'Regulatory inspection reports and findings',
      'Environmental and spill response records'
    ],
    integrationTargets: [
      'Real-time SCADA and DCS systems',
      'Pipeline integrity assessment tools',
      'Pressure relief valve testing systems',
      'Maintenance management systems (CMMS/EAM)',
      'Environmental compliance and incident tracking',
      'Regulatory reporting systems'
    ],
    outputArtifacts: [
      'Daily Production and System Status Dashboard',
      'Monthly Pipeline Integrity Report',
      'Quarterly Risk Assessment and Mitigation Plan',
      'Annual Asset Integrity Report',
      'Process Safety System Certification',
      'Pressure Relief Valve Test and Maintenance Schedule',
      'Regulatory Compliance Evidence Package'
    ],
    confidenceRules: [
      'Production data must be reconciled with custody transfer meters',
      'Pressure readings require dual sensor confirmation at critical points',
      'Pipeline inspection results require certified inspector verification',
      'Pressure relief valve data must reference traceable calibration records',
      'Environmental incident data must be reported to regulatory agencies',
      'Maintenance completion requires timestamped field verification'
    ],
    blockedAutomationRules: [
      'Do not auto-increase operating pressure beyond design limits',
      'Do not bypass or disable safety shutdown systems automatically',
      'Do not auto-adjust pressure relief valve setpoints',
      'Do not modify process parameters without operator confirmation',
      'Do not automatically resume operation after safety system activation',
      'Do not modify environmental compliance thresholds'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  petrochemical: {
    industryCode: 'petrochemical',
    industryName: 'Petrochemical',
    description: 'Refinery, chemical plant, and specialty chemical operations with emphasis on process safety, management of change (MOC), corrosion under insulation (CUI), and hazardous chemical handling.',
    primaryMissionObjective: 'Operate chemical plants safely and continuously while managing process hazards, maintaining catalyst activity, and ensuring product quality and regulatory compliance.',
    commonAssetClasses: [
      'Reactor Vessels and Furnaces',
      'Distillation and Fractionation Towers',
      'Heat Exchangers and Coolers',
      'Catalyst Beds and Regeneration Systems',
      'Pumps and Compressors',
      'Insulated Piping and Vessels',
      'Process Control and Instrumentation',
      'Storage Tanks and Blending Systems'
    ],
    onboardingQuestions: [
      'What are your primary chemical processes - cracking, reforming, polymerization, synthesis?',
      'What catalysts do you use and what are their regeneration cycle times?',
      'How much of your equipment is insulated piping subject to CUI?',
      'What are your key process hazards - exothermic reactions, corrosive fluids, high temperatures?',
      'How many distillation or reactor trains do you operate?',
      'What is your current production capacity and product slate?',
      'What are your MOC procedures and change frequency?',
      'Do you operate loss prevention and layer of protection analysis programs?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Safety-Environmental-Product Quality-Equipment Loss',
      consequenceCategories: [
        'Process Runaway or Explosion',
        'Toxic Release',
        'Personnel Exposure',
        'Product Out of Specification',
        'Equipment Loss'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 3, medium: 9, high: 16, critical: 20 }
    },
    riskDrivers: [
      'Exothermic reaction temperature runaway',
      'Catalyst deactivation and loss of selectivity',
      'Corrosion under insulation causing perforation',
      'Heat exchanger fouling and temperature excursion',
      'Pump seal failure and toxic release',
      'Control system malfunction and process upset'
    ],
    safeguards: [
      'Automated temperature monitoring with dual sensors and high-limit shutdown',
      'Catalyst activity monitoring with online activity testing',
      'Thermal imaging survey for CUI detection (annual)',
      'Differential pressure monitoring for heat exchanger fouling',
      'Emergency cooling systems with isolation and backup power',
      'Process alarm and interlocking systems with regular functional testing'
    ],
    approvalGates: [
      'Process Design - HAZOP and Risk Assessment Review',
      'Catalyst Change - Performance and Safety Verification',
      'Equipment Modification - Engineering and LOPA Review',
      'Operating Parameter Change - MOC and Risk Assessment Approval',
      'Insulation or Coating Application - CUI Mitigation Review'
    ],
    failureModeFocusAreas: [
      'Exothermic reactor runaway and overpressurization',
      'Catalyst poisoning and deactivation rate increase',
      'Corrosion under insulation perforation and small leaks',
      'Heat exchanger tube erosion from two-phase flow',
      'Pump seal degradation and product emission',
      'Separation equipment efficiency loss from fouling',
      'Instrumentation sensor calibration drift'
    ],
    kpiModel: {
      primaryKpis: [
        'Production Rate (tonnes/day)',
        'Process Availability (%)',
        'Catalyst Activity Index',
        'Heat Exchanger Fouling Factor (W/m²K)',
        'Product Quality Specification Adherence (%)',
        'Environmental Incident Rate',
        'Process Safety System Uptime (%)'
      ],
      secondaryKpis: [
        'Energy Efficiency Index',
        'Yield and Selectivity (%)',
        'Pump Seal Run Time to Failure',
        'Instrument Calibration Compliance (%)',
        'MOC Adherence Rate (%)',
        'Preventive Maintenance Completion Rate'
      ],
      kpiTargets: {
        'Production Availability': '95-98%',
        'Product Quality Compliance': '99%+',
        'Environmental Incidents': '0',
        'PSM System Uptime': '99%+'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual monitoring, reactive maintenance',
        'Managed - Scheduled maintenance, basic process monitoring',
        'Optimized - Predictive analytics, integrated optimization',
        'Autonomous - Self-optimizing reactors and processes'
      ],
      minimumForOperation: 'Managed - Daily process monitoring with weekly equipment verification',
      minimumForOptimization: 'Optimized - Real-time analytics with predictive maintenance'
    },
    regulatoryConsiderations: [
      'Process Safety Management (PSM) and Seveso Directive requirements',
      'HAZOP and risk assessment documentation',
      'API 570 (Piping) inspection and compliance',
      'API 582 (Inspection of Refinery Equipment) standards',
      'Mechanical Integrity testing and procedures',
      'Environmental emissions and waste disposal permits'
    ],
    dataSourcesRequired: [
      'Process SCADA and DCS data',
      'Catalyst activity and regeneration logs',
      'Thermal imaging and CUI survey results',
      'Heat exchanger performance and differential pressure data',
      'Equipment inspection and maintenance records',
      'Product quality analysis and laboratory data',
      'Incident and near-miss reports'
    ],
    integrationTargets: [
      'Real-time process control systems (DCS/SCADA)',
      'Catalyst management systems',
      'Thermal imaging and IR survey platforms',
      'Equipment maintenance management (CMMS)',
      'Quality control and laboratory information systems',
      'Environmental compliance tracking'
    ],
    outputArtifacts: [
      'Daily Production and Process Health Dashboard',
      'Weekly Catalyst Performance Report',
      'Monthly Equipment Condition Assessment',
      'Quarterly CUI Risk Assessment Report',
      'Annual Process Safety Certification',
      'HAZOP and Risk Update Summary',
      'MOC Approval and Implementation Record'
    ],
    confidenceRules: [
      'Temperature readings must have dual sensor redundancy',
      'Catalyst activity data must be from certified laboratory analysis',
      'CUI inspection results require qualified thermographer verification',
      'Heat exchanger performance must be baseline-normalized',
      'Product quality data must reference method standard and calibration',
      'MOC documentation must include risk assessment and stakeholder approval'
    ],
    blockedAutomationRules: [
      'Do not auto-increase reaction temperature beyond setpoint',
      'Do not bypass emergency cooling systems',
      'Do not auto-start catalyst regeneration without supervision',
      'Do not modify product specification compliance limits',
      'Do not automatically resume operation after safety shutdown',
      'Do not disable process alarm and interlock systems'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  power_generation: {
    industryCode: 'power_generation',
    industryName: 'Power Generation',
    description: 'Thermal, hydroelectric, wind, and solar power generation facilities with emphasis on grid reliability, dispatch consistency, regulatory compliance, and generation availability.',
    primaryMissionObjective: 'Reliably generate electrical power to meet grid demand and contractual obligations while maintaining environmental compliance and operational efficiency.',
    commonAssetClasses: [
      'Steam Generators and Boilers',
      'Turbines (Steam, Gas, Water, Wind)',
      'Generators and Excitation Systems',
      'Cooling Systems and Condenser',
      'Balance of Plant Equipment',
      'Electrical Switchgear and Transformers',
      'Power Control and SCADA',
      'Renewable Energy Inverters and Battery Storage'
    ],
    onboardingQuestions: [
      'What generation types do you operate - thermal, hydro, wind, solar, or hybrid?',
      'What is your total installed capacity (MW) and nameplate rating?',
      'How many units or turbines are in your operational fleet?',
      'What is your average dispatch capability and ramp rate?',
      'What are your grid regulatory and frequency stability obligations?',
      'How many renewable generation sites do you operate?',
      'What is your current availability factor and forced outage rate?',
      'Do you operate energy storage or battery systems?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Grid Reliability-Safety-Environmental-Financial Impact',
      consequenceCategories: [
        'Loss of Generation Capacity',
        'Grid Instability Event',
        'Environmental Non-Compliance',
        'Equipment Damage',
        'Safety Incident'
      ],
      likelihoodScale: 'Rare-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 16 }
    },
    riskDrivers: [
      'Turbine blade erosion and efficiency loss',
      'Generator bearing temperature excursion',
      'Condenser fouling and water-side corrosion',
      'Excitation system failure and loss of synchronization',
      'Transformer insulation degradation',
      'Weather-related outages in wind and solar facilities'
    ],
    safeguards: [
      'Turbine blade condition monitoring with ultrasonic inspection',
      'Bearing temperature monitoring with redundant sensors',
      'Condenser water chemistry monitoring and biofouling prevention',
      'Excitation system functional testing and backup power supply',
      'Transformer oil analysis and insulation resistance testing (annual)',
      'Weather monitoring and predictive maintenance scheduling'
    ],
    approvalGates: [
      'Unit Modification - Engineering and Regulatory Review',
      'Maintenance Outage Planning - Schedule and Grid Impact Assessment',
      'Replacement Equipment Installation - Engineering and Commissioning',
      'Operating Parameter Change - Grid Stability and Efficiency Review',
      'Battery Storage or Renewable Integration - Grid Compliance Sign-off'
    ],
    failureModeFocusAreas: [
      'Turbine blade stress rupture and catastrophic failure',
      'Generator bearing seizure and motor failure',
      'Condenser leakage and pressure tube corrosion',
      'Excitation system component failure and loss of voltage control',
      'Transformer insulation breakdown and dielectric failure',
      'Power electronics failure in renewable energy converters',
      'Cooling water system fouling and heat exchanger performance loss'
    ],
    kpiModel: {
      primaryKpis: [
        'Capacity Factor (%)',
        'Availability Factor (%)',
        'Forced Outage Rate (FOR)',
        'Dispatch Reliability (%)',
        'Mean Time Between Failures (MTBF)',
        'Energy Efficiency Heat Rate (BTU/kWh)',
        'Grid Frequency Stability'
      ],
      secondaryKpis: [
        'Planned Outage Duration (hours)',
        'Unplanned Outage Duration (hours)',
        'Turbine Efficiency Degradation (%)',
        'Condenser Effectiveness (percentage)',
        'Renewable Generation Variability',
        'Grid Support Services Provision'
      ],
      kpiTargets: {
        'Availability Factor': '92%+',
        'Forced Outage Rate': '<5%',
        'Dispatch Reliability': '98%+',
        'Heat Rate Efficiency': '<10% above design'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual monitoring, reactive maintenance',
        'Managed - Planned maintenance outages, basic monitoring',
        'Optimized - Predictive analytics, condition-based maintenance',
        'Autonomous - Self-optimizing units with autonomous operation'
      ],
      minimumForOperation: 'Managed - Quarterly equipment inspections and planned maintenance',
      minimumForOptimization: 'Optimized - Continuous monitoring with predictive algorithms'
    },
    regulatoryConsiderations: [
      'North American Electric Reliability Corporation (NERC) standards',
      'Grid interconnection and balance requirements',
      'Environmental emissions and air quality permits',
      'Water usage and discharge permits (cooling water)',
      'Nuclear safety regulations (if applicable)',
      'Renewable energy interconnection standards'
    ],
    dataSourcesRequired: [
      'Real-time SCADA generation and grid frequency data',
      'Turbine performance and efficiency monitoring',
      'Bearing temperature and vibration sensors',
      'Condenser performance and water chemistry data',
      'Maintenance records and outage logs',
      'Environmental monitoring and emissions data',
      'Weather and renewable resource forecasts'
    ],
    integrationTargets: [
      'Grid control center SCADA',
      'Turbine condition monitoring systems',
      'Maintenance management (CMMS)',
      'Environmental compliance tracking',
      'Energy Management System (EMS)',
      'Renewable energy forecasting platforms'
    ],
    outputArtifacts: [
      'Hourly Generation and Frequency Dashboard',
      'Weekly Unit Availability Report',
      'Monthly Performance and Efficiency Analysis',
      'Quarterly Maintenance Outage Plan',
      'Annual Capacity Factor and Dispatch Reliability Report',
      'Predictive Maintenance Recommendations',
      'Grid Compliance and Regulatory Reporting Package'
    ],
    confidenceRules: [
      'Generation data must be certified by grid operators',
      'Efficiency measurements require baseline comparison normalization',
      'Bearing temperature must have dual independent sensors',
      'Condenser performance data requires weekly chemistry verification',
      'Outage data must be registered with grid authority',
      'Environmental data requires certified laboratory analysis'
    ],
    blockedAutomationRules: [
      'Do not auto-increase power output beyond frequency regulation bands',
      'Do not bypass synchronization protection systems',
      'Do not auto-shut down units without grid operator coordination',
      'Do not modify generator excitation setpoints autonomously',
      'Do not automatically restart units after major fault',
      'Do not disable environmental compliance monitoring'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  utilities: {
    industryCode: 'utilities',
    industryName: 'Utilities',
    description: 'Water supply, wastewater treatment, and gas distribution networks with emphasis on service continuity, public health protection, and regulatory compliance.',
    primaryMissionObjective: 'Continuously deliver safe, reliable utility services to customer base while maintaining infrastructure integrity and regulatory compliance.',
    commonAssetClasses: [
      'Water Treatment Plants',
      'Wastewater Treatment Facilities',
      'Water Distribution Mains and Pipes',
      'Gas Distribution Networks and Regulators',
      'Pumping Stations and Lift Stations',
      'Chlorination and Chemical Dosing Systems',
      'SCADA and Control Systems',
      'Metering and Flow Measurement Equipment'
    ],
    onboardingQuestions: [
      'What is your primary utility service - water supply, wastewater, gas distribution, or combination?',
      'What is your daily service volume (million gallons per day or million cubic feet)?',
      'How many customers do you serve and what is the geographic coverage area?',
      'What is the age and condition of your main transmission infrastructure?',
      'What are your current water loss percentages and leak detection capabilities?',
      'Do you operate emergency response protocols for service disruption?',
      'What treatment chemicals or processes do you employ?',
      'How many treatment plants or pumping stations are in your system?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Public Health-Service Continuity-Environmental-Safety Impact',
      consequenceCategories: [
        'Service Interruption',
        'Water Quality Non-Compliance',
        'Public Health Event',
        'Environmental Violation',
        'Infrastructure Damage'
      ],
      likelihoodScale: 'Rare-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 15 }
    },
    riskDrivers: [
      'Main line breaks and pressure loss',
      'Contamination ingress and water quality degradation',
      'Pump failure and loss of lift capacity',
      'Treatment chemical supply disruption',
      'Control system cyber-attack or malfunction',
      'Aging pipe corrosion and internal tuberculation'
    ],
    safeguards: [
      'Real-time pressure and flow monitoring across distribution network',
      'Water quality monitoring at treatment and distribution points',
      'Automated leak detection and isolation systems',
      'Redundant pumping capacity at lift stations',
      'Treatment chemical backup supply and automatic dosing verification',
      'Network redundancy and interconnected mains for isolation capability'
    ],
    approvalGates: [
      'Main Replacement or Relocation - Engineering and Service Impact Review',
      'Treatment Process Change - Water Quality and Regulatory Sign-off',
      'Equipment Addition - Capacity and Redundancy Assessment',
      'Chemical Supplier Change - Quality and Safety Review',
      'System Upgrade or Expansion - Capital and Regulatory Approval'
    ],
    failureModeFocusAreas: [
      'Cast iron main corrosion and internal tuberculation',
      'Water loss from pipe leaks and service lateral breaks',
      'Pump cavitation and impeller erosion',
      'Treatment system bypass and inadequate chlorination',
      'Lift station power failure and backflow',
      'Water hammer events and pressure surges',
      'Microbial contamination breakthrough'
    ],
    kpiModel: {
      primaryKpis: [
        'Water Loss Percentage (%)',
        'System Availability (%)',
        'Water Quality Compliance (%)',
        'Customer Service Interruption Duration (hours)',
        'Main Break Frequency (breaks per 100 miles per year)',
        'Treatment Plant Uptime (%)',
        'Leak Detection and Response Time'
      ],
      secondaryKpis: [
        'Average Daily Demand vs. Capacity',
        'Peak Demand Responsiveness',
        'Pressure Consistency (%)',
        'Residual Chlorine Stability',
        'Pump Efficiency Index',
        'Meter Reading Accuracy (%)'
      ],
      kpiTargets: {
        'Water Loss': '<10%',
        'System Availability': '99%+',
        'Water Quality Compliance': '100%',
        'Main Break Frequency': '<3 per 100 miles/year'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual monitoring, reactive repairs',
        'Managed - Preventive maintenance, scheduled inspections',
        'Optimized - Predictive analytics, automated detection',
        'Autonomous - Self-healing networks with autonomous optimization'
      ],
      minimumForOperation: 'Managed - Monthly inspections and preventive maintenance schedule',
      minimumForOptimization: 'Optimized - Real-time monitoring with automated leak detection'
    },
    regulatoryConsiderations: [
      'Safe Drinking Water Act (SDWA) and water quality standards',
      'Clean Water Act and wastewater discharge permits',
      'Backflow prevention and cross-connection control',
      'Chlorine handling and safety procedures',
      'Water system security and cyber resilience requirements',
      'Community notification and public reporting requirements'
    ],
    dataSourcesRequired: [
      'Real-time SCADA pressure and flow data',
      'Water quality monitoring (chlorine, pH, turbidity, bacteria)',
      'Pipe asset inventory and age database',
      'Leak detection system data',
      'Pump performance and runtime logs',
      'Customer complaint and service request records',
      'Weather and seasonal demand data'
    ],
    integrationTargets: [
      'Distribution system SCADA',
      'Water quality monitoring equipment',
      'GIS mapping and asset management',
      'Leak detection networks',
      'Maintenance management systems (CMMS)',
      'Meter reading systems (AMI/AMR)'
    ],
    outputArtifacts: [
      'Daily System Status and Pressure Dashboard',
      'Weekly Water Quality Compliance Report',
      'Monthly Leak Detection and Main Break Analysis',
      'Quarterly Asset Condition Report',
      'Annual Water Loss and Efficiency Report',
      'Predictive Maintenance Schedule',
      'Regulatory Compliance Certification'
    ],
    confidenceRules: [
      'Pressure readings require real-time validation across multiple points',
      'Water quality data must reference certified laboratory analysis',
      'Main break data must be correlated with field inspection records',
      'Leak detection alerts require manual field verification',
      'Outage data must be documented with duration and impact',
      'Pump performance must be baseline-normalized for comparison'
    ],
    blockedAutomationRules: [
      'Do not auto-adjust water treatment without operator verification',
      'Do not bypass pressure relief systems automatically',
      'Do not auto-isolate mains without customer notification',
      'Do not modify water quality setpoints without regulatory approval',
      'Do not automatically restart pumps after pressure loss',
      'Do not disable backflow prevention monitoring'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  manufacturing: {
    industryCode: 'manufacturing',
    industryName: 'Manufacturing',
    description: 'Discrete and process manufacturing facilities with emphasis on overall equipment effectiveness (OEE), changeover performance, product quality, and production line balancing.',
    primaryMissionObjective: 'Maximize production output and quality while minimizing downtime and waste through optimized equipment performance and efficient line balancing.',
    commonAssetClasses: [
      'CNC Machining and Turning Centers',
      'Robotic Assembly Equipment',
      'Injection Molding and Forming Presses',
      'Conveyor and Material Handling Systems',
      'Welding Equipment and Welding Cells',
      'Testing and Inspection Equipment',
      'Industrial Robots and Grippers',
      'Process Control and Production Management'
    ],
    onboardingQuestions: [
      'What product families do you manufacture and what are their complexity levels?',
      'How many production lines or manufacturing cells are in operation?',
      'What is your current production capacity (units per day or tonnes per day)?',
      'What is your current OEE percentage and target?',
      'How many SKUs or variants do you produce and how frequently do changeovers occur?',
      'What are your quality defect rates and primary failure modes?',
      'Do you operate pull-system (Lean/Kanban) or push-system production?',
      'How many robotic or automated stations are in your production lines?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Production-Quality-Safety-Equipment Loss Impact',
      consequenceCategories: [
        'Production Stoppage',
        'Quality Defect Escape',
        'Personnel Injury',
        'Equipment Damage',
        'Schedule Miss'
      ],
      likelihoodScale: 'Rare-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 5, high: 10, critical: 16 }
    },
    riskDrivers: [
      'Spindle bearing wear and tool chatter',
      'Robot arm joint degradation and positional accuracy loss',
      'Conveyor belt misalignment and product damage',
      'Press hydraulic failure and force loss',
      'Welding equipment electrode or consumable issues',
      'Sensor drift and quality measurement error'
    ],
    safeguards: [
      'Spindle vibration monitoring and tool breakage detection',
      'Robot accuracy verification and drift compensation',
      'Conveyor belt alignment monitoring and speed feedback',
      'Hydraulic pressure and flow monitoring on presses',
      'Welding quality monitoring with real-time arc current feedback',
      'Automated part inspection and statistical process control'
    ],
    approvalGates: [
      'New Product Tooling and Setup - Engineering Review',
      'Production Line Reconfiguration - Capacity and Safety Assessment',
      'Equipment Addition or Replacement - Throughput and Integration Verification',
      'Changeover Procedure Change - Efficiency and Quality Impact',
      'Automation Upgrade - Technical Feasibility and Business Case'
    ],
    failureModeFocusAreas: [
      'Spindle bearing preload loss and increased runout',
      'Robot accuracy drift beyond tolerance zone',
      'Conveyor belt slip and stall under load',
      'Press valve leakage and force degradation',
      'Welding electrode wear and weld nugget size variation',
      'Part handling gripper wear and drop failures',
      'Sensor baseline drift and false defect signals'
    ],
    kpiModel: {
      primaryKpis: [
        'Overall Equipment Effectiveness (OEE %)',
        'Availability (%)',
        'Performance (Speed) (%)',
        'Quality (% defect-free) (%)',
        'Changeover Time (minutes)',
        'Defect Rate (ppm)',
        'Production Throughput (units/day)'
      ],
      secondaryKpis: [
        'Mean Time Between Failures (MTBF)',
        'Mean Time to Repair (MTTR)',
        'Downtime by Reason (%)',
        'Cycle Time Stability (sigma)',
        'First Pass Yield (%)',
        'Schedule Adherence (%)'
      ],
      kpiTargets: {
        'OEE': '85%+',
        'Availability': '90%+',
        'Quality': '99%+',
        'Defect Rate': '<100 ppm'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual inspections, reactive maintenance',
        'Managed - Preventive maintenance schedule, basic monitoring',
        'Optimized - Predictive analytics, integrated production optimization',
        'Autonomous - Autonomous production lines with self-optimization'
      ],
      minimumForOperation: 'Managed - Daily equipment verification with scheduled PM',
      minimumForOptimization: 'Optimized - Real-time OEE analytics with predictive maintenance'
    },
    regulatoryConsiderations: [
      'Occupational Safety and Health Administration (OSHA) compliance',
      'Machine guarding and lockout/tagout (LOTO) procedures',
      'Product quality standards (ISO 9001, AS9100 if aerospace)',
      'Environmental emissions and waste disposal permits',
      'Electrical safety and harmonics compliance',
      'Pressure equipment and hydraulic system safety directives'
    ],
    dataSourcesRequired: [
      'Production line SCADA and PLC data',
      'Machine performance metrics (cycle time, position, force)',
      'Maintenance records and equipment service logs',
      'Quality inspection and measurement data',
      'Downtime and stoppage event logs',
      'Robot accuracy and positioning logs',
      'Sensor and gauge calibration records'
    ],
    integrationTargets: [
      'Production control systems (MES)',
      'Quality management systems (QMS)',
      'Maintenance management (CMMS/EAM)',
      'Supply chain and inventory systems',
      'Robot programming and control systems',
      'Statistical process control platforms'
    ],
    outputArtifacts: [
      'Daily OEE Dashboard (availability, performance, quality)',
      'Weekly Production Schedule vs. Actual Report',
      'Monthly Defect Analysis and Root Cause Report',
      'Quarterly Changeover Process Optimization Plan',
      'Annual Equipment Criticality and Maintenance Schedule',
      'Predictive Maintenance Recommendations Report',
      'Quality Capability Analysis (Cpk, Ppk)'
    ],
    confidenceRules: [
      'OEE calculations must use consistent stoppage definitions',
      'Quality data must be traceable to part serial number and lot',
      'Downtime events must be recorded with operator and reason code',
      'Cycle time measurements require sensor timestamp verification',
      'Production counts must be reconciled with part serialization',
      'Equipment parameter changes require configuration control documentation'
    ],
    blockedAutomationRules: [
      'Do not auto-increase line speed beyond nominal rate',
      'Do not bypass product inspection systems',
      'Do not auto-restart equipment after safety interlock activation',
      'Do not modify quality acceptance thresholds without approval',
      'Do not disable preventive maintenance alerts',
      'Do not automatically adjust tooling offsets'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  food_beverage: {
    industryCode: 'food_beverage',
    industryName: 'Food & Beverage',
    description: 'Food processing, dairy, and brewing operations with emphasis on HACCP compliance, sanitation standards, allergen management, and cold chain integrity.',
    primaryMissionObjective: 'Produce safe, high-quality food and beverage products while maintaining HACCP compliance, hygiene standards, and cold chain integrity.',
    commonAssetClasses: [
      'Processing Equipment (Mixers, Grinders, Blanchers)',
      'Pasteurization and Sterilization Systems',
      'Refrigeration and Cold Chain Equipment',
      'Packaging Lines and Sealing Equipment',
      'Monitoring and Testing Equipment',
      'Sanitation and CIP Systems',
      'Warehouse and Storage Management',
      'Traceability and Coding Systems'
    ],
    onboardingQuestions: [
      'What product categories do you process - meat, dairy, beverage, bakery, specialty?',
      'What is your daily production volume and number of SKUs?',
      'How many processing lines or production runs per day?',
      'What are your cold chain storage requirements and setpoints?',
      'Do you handle high-allergen ingredients and what is your segregation protocol?',
      'What sanitation and CIP (clean-in-place) procedures do you follow?',
      'What food safety certifications do you hold - FSSC 22000, BRC, SQF?',
      'How do you track and trace products through the supply chain?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Food Safety-Compliance-Product Quality-Equipment Loss',
      consequenceCategories: [
        'Food Safety Incident or Recall',
        'Regulatory Non-Compliance',
        'Allergen Cross-Contamination',
        'Cold Chain Failure',
        'Product Quality Defect'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 3, medium: 8, high: 15, critical: 20 }
    },
    riskDrivers: [
      'Pathogenic contamination from processing equipment',
      'Allergen cross-contamination from shared equipment',
      'Temperature excursion in cold storage or transport',
      'Pasteurization system failure and inadequate heat treatment',
      'Sanitation procedure deviation and biofilm formation',
      'Foreign material contamination (glass, metal, plastic)'
    ],
    safeguards: [
      'Environmental monitoring and swab testing program',
      'Allergen segregation and dedicated production lines',
      'Temperature monitoring at freezer, cooler, and transport levels',
      'Continuous pasteurization recording and verification',
      'Cleaning validation and ATP (adenosine triphosphate) testing',
      'Metal detectors and X-ray inspection at packaging stage'
    ],
    approvalGates: [
      'New Product Introduction - HACCP and Allergen Review',
      'Equipment Addition or Change - Food Safety and Cross-Contamination Assessment',
      'Sanitation Procedure Update - Validation and CIP System Verification',
      'Cold Chain Modification - Temperature Mapping and Compliance Review',
      'Supplier or Ingredient Change - Food Safety and Allergen Documentation'
    ],
    failureModeFocusAreas: [
      'Pathogenic growth in processing equipment crevices',
      'Allergen cross-contact from shared utensils or equipment',
      'Freezer or cooler thermostat failure and temperature loss',
      'Pasteurization plate heat exchanger fouling',
      'CIP system nozzle clogging and dead leg biofilm',
      'Packaging line seal failure and product exposure',
      'Refrigerated transport unit compressor failure'
    ],
    kpiModel: {
      primaryKpis: [
        'Pathogenic Test Results (zero tolerance)',
        'Allergen Presence Test Results (zero tolerance)',
        'Cold Chain Temperature Compliance (%)',
        'Sanitation ATP Test Pass Rate (%)',
        'Production Yield (% saleable)',
        'Food Safety Incident Count',
        'Recall Incidents (count)'
      ],
      secondaryKpis: [
        'Shelf Life Integrity (%)',
        'Product Coding Accuracy (%)',
        'Environmental Swab Test Results',
        'Supplier Audit Score',
        'Temperature Excursion Duration',
        'Preventive Maintenance Compliance (%)'
      ],
      kpiTargets: {
        'Pathogenic Test': '0 incidents',
        'Allergen Test': '0 incidents',
        'Cold Chain Compliance': '99%+',
        'ATP Test Pass Rate': '98%+'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Reactive sanitation, manual testing',
        'Managed - Scheduled sanitation and CIP cycles',
        'Optimized - Predictive sanitation with continuous monitoring',
        'Autonomous - Autonomous food safety systems with real-time monitoring'
      ],
      minimumForOperation: 'Managed - Daily sanitation procedures and weekly environmental testing',
      minimumForOptimization: 'Optimized - Continuous temperature and ATP monitoring'
    },
    regulatoryConsiderations: [
      'Food Safety Modernization Act (FSMA) compliance',
      'HACCP principles and prerequisite programs',
      'Allergen labeling and segregation requirements',
      'FSSC 22000, BRC, or SQF certification maintenance',
      'Cold chain and temperature monitoring requirements',
      'Traceability and recall procedures'
    ],
    dataSourcesRequired: [
      'Temperature data from freezers, coolers, and transport',
      'Environmental and product pathogenic test results',
      'Allergen presence and cross-contamination test data',
      'Sanitation records and ATP test results',
      'Production logs and product traceability data',
      'Equipment maintenance and cleaning records',
      'Supplier testing and qualification records'
    ],
    integrationTargets: [
      'Cold chain temperature monitoring systems',
      'Environmental and product testing laboratory systems',
      'Production scheduling and traceability systems',
      'Maintenance management systems (CMMS)',
      'Quality management systems (QMS)',
      'Supply chain and supplier management systems'
    ],
    outputArtifacts: [
      'Daily Cold Chain Temperature Report',
      'Weekly Environmental Monitoring Results',
      'Monthly HACCP Control Point Review',
      'Quarterly Allergen Segregation Audit',
      'Annual Food Safety Certification Renewal',
      'Supplier Audit and Qualification Report',
      'Product Recall and Traceability Drill Report'
    ],
    confidenceRules: [
      'Pathogenic test results must use certified laboratory analysis',
      'Temperature readings require continuous sensor logging with alarm verification',
      'Allergen data must include dedicated lab analysis and control samples',
      'Sanitation ATP readings must be calibrated to standards',
      'Traceability data must be reconciled with shipping records',
      'Environmental testing must include positive controls and blanks'
    ],
    blockedAutomationRules: [
      'Do not auto-modify CIP cycle parameters',
      'Do not automatically increase processing temperature beyond validated limits',
      'Do not bypass metal detector or X-ray inspection',
      'Do not modify allergen segregation protocols',
      'Do not auto-restart production after food safety alert',
      'Do not disable temperature excursion alarms'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  pharmaceuticals: {
    industryCode: 'pharmaceuticals',
    industryName: 'Pharmaceuticals',
    description: 'GMP-regulated pharmaceutical production facilities with emphasis on product validation, cGMP compliance, deviation management, CAPA implementation, and batch integrity.',
    primaryMissionObjective: 'Produce pharmaceuticals in full compliance with cGMP regulations while maintaining product quality, batch integrity, and traceability.',
    commonAssetClasses: [
      'Manufacturing Equipment (Reactors, Bioreactors, Dryers)',
      'Purification and Separation Systems',
      'Filtration and Sterilization Equipment',
      'Filling and Finishing Lines',
      'Environmental Monitoring Systems',
      'Laboratory Analytical Equipment',
      'Refrigerated Storage and Stability Chambers',
      'Data Management and Batch Record Systems'
    ],
    onboardingQuestions: [
      'What pharmaceutical products do you manufacture - small molecule, biologics, vaccines?',
      'What is your manufacturing capacity (doses, units, or mass per year)?',
      'How many manufacturing suites or batch trains are in operation?',
      'What is your current batch success rate and first-pass yield?',
      'What are your primary cGMP compliance gaps or focus areas?',
      'How do you manage deviations and implement corrective actions (CAPA)?',
      'What analytical testing do you perform in-house vs. contract labs?',
      'What environmental monitoring and cleanroom classification do you maintain?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Product Quality-Regulatory-Safety-Business Impact',
      consequenceCategories: [
        'Batch Failure or Rejection',
        'Regulatory Non-Compliance or Warning Letter',
        'Product Contamination or Impurity',
        'Deviation and CAPA Implementation',
        'Supply Chain Disruption'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 3, medium: 9, high: 16, critical: 20 }
    },
    riskDrivers: [
      'Equipment calibration drift and measurement error',
      'Environmental contamination in manufacturing areas',
      'Process parameter excursion outside validated ranges',
      'Raw material or component quality variation',
      'Data integrity issues and audit trail gaps',
      'Change management procedure non-compliance'
    ],
    safeguards: [
      'Automated equipment qualification and OQ/PQ verification',
      'Real-time environmental monitoring (particle count, viable)',
      'Process parameter monitoring with SPC and deviation alarms',
      'Supplier qualification and incoming material testing',
      'Electronic batch records (EBR) with audit trails',
      'Deviation investigation and CAPA tracking system'
    ],
    approvalGates: [
      'New Product Launch - IND/NDA and CMC Approval',
      'Process Change - Change Management and Risk Assessment Review',
      'Equipment Qualification - OQ/PQ Execution and Report Sign-off',
      'Deviation Notification - Investigation and CAPA Plan Review',
      'CAPA Completion - Effectiveness Verification and Closure'
    ],
    failureModeFocusAreas: [
      'Equipment calibration failure and measurement error',
      'Cleanroom environmental contamination and viable organism growth',
      'Bioreactor foam or contamination and batch loss',
      'Filter integrity loss and microbial breakthrough',
      'Filling line defect and product leakage',
      'Stability chamber temperature excursion',
      'Data system failure and audit trail loss'
    ],
    kpiModel: {
      primaryKpis: [
        'Batch Success Rate / First Pass Yield (%)',
        'GMP Compliance Score (%)',
        'Deviation Incident Rate',
        'CAPA Closure Rate (%)',
        'Environmental Monitoring Pass Rate (%)',
        'Analytical Test Result Reliability',
        'Equipment Calibration Compliance (%)'
      ],
      secondaryKpis: [
        'Process Parameter Control (Cpk)',
        'Supplier Quality Score',
        'Data Integrity Audit Findings',
        'Training Compliance (%)',
        'Regulatory Inspection Findings',
        'Product Shelf Life Stability'
      ],
      kpiTargets: {
        'Batch Success Rate': '98%+',
        'GMP Compliance': '95%+',
        'Deviation Rate': '<5 per year',
        'CAPA Closure': '100% on time'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Reactive testing, manual batch records',
        'Managed - Scheduled testing and validation cycles',
        'Optimized - Predictive quality with real-time monitoring',
        'Autonomous - Autonomous batch systems with self-optimization'
      ],
      minimumForOperation: 'Managed - Quarterly equipment qualification and validated methods',
      minimumForOptimization: 'Optimized - Continuous monitoring with predictive quality analytics'
    },
    regulatoryConsiderations: [
      '21 CFR Part 11 (Electronic Records, Electronic Signatures)',
      'ICH Q7 (Quality Overall Summary for Pharmaceutical Drug Substance)',
      'ICH Q2(R2) (Validation of Analytical Procedures)',
      'FDA GMP regulations (21 CFR Part 211)',
      'WHO Good Manufacturing Practices requirements',
      'Deviation reporting and inspection readiness'
    ],
    dataSourcesRequired: [
      'Equipment calibration and qualification records',
      'Environmental monitoring data (particle count, viable)',
      'Process parameter logs and batch records',
      'Analytical test results and stability data',
      'Supplier audit and material testing records',
      'Deviation investigation and CAPA tracking logs',
      'Personnel training and qualification records'
    ],
    integrationTargets: [
      'Electronic batch record (EBR) systems',
      'Environmental monitoring systems',
      'Laboratory information management system (LIMS)',
      'Equipment SCADA and data logging',
      'Quality management systems (QMS)',
      'Deviation and CAPA tracking systems'
    ],
    outputArtifacts: [
      'Daily Batch Status and Process Parameter Report',
      'Weekly Environmental Monitoring Summary',
      'Monthly Equipment Qualification Status Report',
      'Quarterly Deviation and CAPA Trend Analysis',
      'Annual Product Stability and Shelf Life Assessment',
      'Annual GMP Compliance Assessment',
      'Regulatory Inspection Readiness Checklist'
    ],
    confidenceRules: [
      'Analytical test data must reference validated methods and calibration',
      'Environmental data must be from certified instruments with traceability',
      'Process parameter readings require automatic sensor verification',
      'Batch record data must have electronic signatures and audit trails',
      'Deviation investigation must be documented within 24 hours',
      'Supplier material testing must use qualified lab and retained samples'
    ],
    blockedAutomationRules: [
      'Do not auto-approve batch release without QA sign-off',
      'Do not modify process parameter setpoints without change control',
      'Do not automatically restart equipment after alarm event',
      'Do not bypass environmental monitoring requirements',
      'Do not disable temperature or pressure alarm systems',
      'Do not modify analytical test acceptance criteria'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  transportation_logistics: {
    industryCode: 'transportation_logistics',
    industryName: 'Transportation & Logistics',
    description: 'Fleet management, rail, and port operations with emphasis on schedule reliability, vehicle availability, and personnel safety in transportation environments.',
    primaryMissionObjective: 'Reliably deliver goods on schedule while maintaining fleet availability, operator safety, and compliance with transportation regulations.',
    commonAssetClasses: [
      'Trucks and Heavy Vehicles',
      'Locomotives and Rail Cars',
      'Trailers and Containers',
      'Port Equipment and Cranes',
      'Fuel and Maintenance Facilities',
      'Tracking and Telematics Systems',
      'Refrigeration and Specialized Containers',
      'Loading and Unloading Equipment'
    ],
    onboardingQuestions: [
      'What transportation modes do you operate - trucks, rail, intermodal, or port?',
      'What is your total fleet size and average vehicle age?',
      'What is your daily shipment volume and average distance per trip?',
      'What is your current on-time delivery percentage?',
      'How many drivers or operators do you employ?',
      'What are your maintenance facilities and repair capabilities?',
      'Do you operate refrigerated or specialized cargo requirements?',
      'What is your current fuel efficiency and emission compliance status?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Safety-On-Time Performance-Regulatory-Financial Impact',
      consequenceCategories: [
        'Delivery Delay or Miss',
        'Vehicle Breakdown on Route',
        'Safety Incident or Accident',
        'Regulatory Non-Compliance',
        'Cargo Loss or Damage'
      ],
      likelihoodScale: 'Rare-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 16 }
    },
    riskDrivers: [
      'Engine failure and roadside breakdown',
      'Brake system degradation and stopping distance loss',
      'Tire blowout and loss of vehicle control',
      'Driver fatigue and vigilance loss',
      'Fuel system contamination and stalling',
      'Transmission fluid overheating and loss of power'
    ],
    safeguards: [
      'Predictive maintenance alerts based on telematics data',
      'Pre-trip and post-trip vehicle inspection protocols',
      'Brake system monitoring and automated testing',
      'Tire pressure monitoring and wear tracking',
      'Driver fatigue detection and mandatory rest enforcement',
      'Route optimization to minimize breakdowns and delays'
    ],
    approvalGates: [
      'New Vehicle Addition - Maintenance Capability and Compliance Assessment',
      'Fleet Modernization - Cost-Benefit and Downtime Impact',
      'Route or Service Expansion - Maintenance and Driver Availability',
      'Refrigeration or Specialized Equipment - Capability and Compliance Verification',
      'Maintenance Facility Upgrade - Technician Skill and Tool Assessment'
    ],
    failureModeFocusAreas: [
      'Engine oil degradation and bearing wear',
      'Brake fade and loss of stopping power',
      'Tire cord separation and blowout',
      'Suspension component fatigue and cracking',
      'Electrical system voltage regulation failure',
      'Fuel pump cavitation and no-start condition',
      'Transmission torque converter shudder and slippage'
    ],
    kpiModel: {
      primaryKpis: [
        'On-Time Delivery Rate (%)',
        'Fleet Availability (%)',
        'Roadside Breakdown Incidents',
        'Driver Safety Incidents (TRIFR)',
        'Fuel Efficiency (miles per gallon)',
        'Schedule Reliability (%)',
        'Mean Time Between Failures (MTBF)'
      ],
      secondaryKpis: [
        'Average Unplanned Downtime (hours)',
        'Preventive Maintenance Compliance (%)',
        'Accident Rate (incidents per million miles)',
        'Vehicle Utilization Rate (%)',
        'Customer Complaint Rate',
        'Maintenance Cost per Mile'
      ],
      kpiTargets: {
        'On-Time Delivery': '98%+',
        'Fleet Availability': '92%+',
        'Roadside Breakdowns': '<2%',
        'Driver Safety': '<1.0 TRIFR'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Reactive maintenance, minimal monitoring',
        'Managed - Scheduled maintenance, basic telematics',
        'Optimized - Predictive maintenance with route optimization',
        'Autonomous - Autonomous vehicle operation with self-maintenance'
      ],
      minimumForOperation: 'Managed - Pre-trip inspections with monthly maintenance schedule',
      minimumForOptimization: 'Optimized - Real-time telematics with predictive maintenance'
    },
    regulatoryConsiderations: [
      'Commercial Driver License (CDL) and hours of service regulations',
      'Vehicle maintenance and inspection (CVSA) standards',
      'Hazardous materials transportation (HAZMAT) compliance',
      'Emissions and fuel efficiency standards',
      'Cargo securing and tie-down regulations',
      'Accident reporting and incident documentation'
    ],
    dataSourcesRequired: [
      'Vehicle telematics data (GPS, speed, fuel consumption, engine diagnostics)',
      'Maintenance records and service logs',
      'Pre-trip and post-trip inspection reports',
      'Driver logs and hours of service records',
      'Fuel consumption and efficiency data',
      'Accident and incident reports',
      'Weather and traffic condition data'
    ],
    integrationTargets: [
      'Fleet telematics and GPS tracking systems',
      'Maintenance management and scheduling systems',
      'Driver management and compliance systems',
      'Fuel management and efficiency platforms',
      'Route optimization and dispatch systems',
      'Accident and incident reporting systems'
    ],
    outputArtifacts: [
      'Daily On-Time Delivery and Availability Dashboard',
      'Weekly Fleet Maintenance Status Report',
      'Monthly Breakdown and Roadside Incident Analysis',
      'Quarterly Driver Safety and Compliance Report',
      'Annual Fleet Condition and Utilization Assessment',
      'Predictive Maintenance Schedule (3-month forward)',
      'Fuel Efficiency and Emission Compliance Report'
    ],
    confidenceRules: [
      'Telematics data must have minimum 95% GPS coverage',
      'Delivery time must be reconciled with customer confirmation',
      'Maintenance records must include actual completion dates',
      'Pre-trip inspection data requires driver signature verification',
      'Breakdown data must include roadside service confirmation',
      'Accident data must reference police report or insurance claim'
    ],
    blockedAutomationRules: [
      'Do not auto-increase route distance beyond vehicle range',
      'Do not bypass pre-trip inspection requirements',
      'Do not auto-dispatch fatigued drivers',
      'Do not override mandatory rest break requirements',
      'Do not automatically disable safety systems',
      'Do not modify fuel efficiency targets without analysis'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  aviation: {
    industryCode: 'aviation',
    industryName: 'Aviation',
    description: 'Maintenance, repair, and overhaul (MRO) operations and fleet maintenance with emphasis on airworthiness certification, airworthiness directive (AD) compliance, minimum equipment list (MEL) adherence, and dispatch reliability.',
    primaryMissionObjective: 'Maintain fleet airworthiness and dispatch reliability while ensuring full compliance with airworthiness directives and regulatory certification.',
    commonAssetClasses: [
      'Aircraft Airframes and Fuselage',
      'Engines and Engine Components',
      'Hydraulic and Pneumatic Systems',
      'Electrical Systems and Batteries',
      'Avionics and Flight Management Systems',
      'Landing Gear and Wheels',
      'Composite and Structural Panels',
      'Interior and Cabin Systems'
    ],
    onboardingQuestions: [
      'How many aircraft are in your active fleet and what is the average age?',
      'What aircraft types and engine models do you maintain?',
      'What is your current on-time dispatch reliability rate?',
      'How many maintenance check intervals (A-Check, C-Check, D-Check) are pending?',
      'What is your current compliance status with outstanding ADs?',
      'How many items are on your maintenance deferred list using MEL authority?',
      'Do you perform heavy maintenance in-house or contract externally?',
      'What is your turnaround time for routine and heavy maintenance?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Safety-Airworthiness-Compliance-Operational Impact',
      consequenceCategories: [
        'Aircraft Grounding',
        'In-Flight Incident or Accident',
        'Airworthiness Non-Compliance',
        'AD Non-Compliance',
        'Schedule Disruption'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 18 }
    },
    riskDrivers: [
      'Engine blade cracking and foreign object damage (FOD)',
      'Hydraulic system component failure and pressure loss',
      'Electrical system short circuit and fire',
      'Fatigue crack initiation in fuselage or wing structures',
      'Airworthiness directive non-compliance and regulatory violation',
      'Deferred maintenance MEL item remaining non-compliant'
    ],
    safeguards: [
      'Borescope inspection of engine hot sections and blade surfaces',
      'Hydraulic fluid analysis and condition monitoring',
      'Electrical system load analysis and fault isolation',
      'Ultrasonic and eddy current inspection of critical structures',
      'AD tracking system with compliance verification',
      'MEL item tracking with mandatory compliance deadlines'
    ],
    approvalGates: [
      'Major Maintenance Check - Engineering Review and Work Scope Approval',
      'AD Implementation - Compliance Verification and Documentation',
      'Engine Overhaul - Performance Testing and Airworthiness Release',
      'Airframe Modification - Design and Certification Approval',
      'Deferred Maintenance MEL Item Closure - Technical and Compliance Sign-off'
    ],
    failureModeFocusAreas: [
      'Engine compressor blade fatigue crack initiation',
      'Hydraulic seal degradation and fluid leakage',
      'Electrical connector corrosion and intermittent faults',
      'Fuselage skin fastener fretting and crack propagation',
      'Landing gear bearing spalling and torque tube bending',
      'Composite sandwich panel delamination and disbond',
      'Flight control actuator seal failure and control loss'
    ],
    kpiModel: {
      primaryKpis: [
        'Dispatch Reliability Rate (%)',
        'Airworthiness Compliance Score (%)',
        'AD Compliance Rate (%)',
        'MEL Compliance Rate (%)',
        'Mean Time Between Unscheduled Removals (MTBUR)',
        'On-Time Maintenance Completion (%)',
        'Maintenance-Induced Delay Events'
      ],
      secondaryKpis: [
        'Engine Overhaul Cost per Flight Hour',
        'Turnaround Time (hours)',
        'Scheduled Maintenance Compliance (%)',
        'Quality Defect Rate (repeat work %)',
        'Aircraft Availability (%)',
        'Fuel Efficiency vs. Plan'
      ],
      kpiTargets: {
        'Dispatch Reliability': '99%+',
        'Airworthiness Compliance': '100%',
        'AD Compliance': '100%',
        'MEL Compliance': '100%'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Maintenance-on-failure, reactive approach',
        'Managed - Scheduled maintenance per check intervals',
        'Optimized - Predictive analytics with condition-based maintenance',
        'Autonomous - Autonomous systems with real-time optimization'
      ],
      minimumForOperation: 'Managed - Compliance with scheduled check intervals and AD requirements',
      minimumForOptimization: 'Optimized - Predictive analytics with real-time component monitoring'
    },
    regulatoryConsiderations: [
      'Federal Aviation Administration (FAA) Part 43 maintenance standards',
      'Continuing Airworthiness Maintenance Program (CAMP) compliance',
      'Airworthiness Directive (AD) tracking and compliance',
      'Minimum Equipment List (MEL) authority and exceptions',
      'Engine and propeller manufacturer service bulletins',
      'Aircraft Maintenance Manual (AMM) and Technical Order compliance'
    ],
    dataSourcesRequired: [
      'Maintenance record system with compliance tracking',
      'Engine and component flight hour data',
      'Borescope inspection reports and blade condition',
      'Hydraulic fluid analysis and test results',
      'Electrical system fault codes and diagnostics',
      'Structural inspection and crack detection reports',
      'AD implementation and compliance verification records'
    ],
    integrationTargets: [
      'Aircraft maintenance management system (MMS)',
      'Engine condition monitoring system',
      'Airworthiness directive tracking system',
      'Component reliability and utilization database',
      'Maintenance work order and scheduling system',
      'Regulatory compliance and audit system'
    ],
    outputArtifacts: [
      'Daily Dispatch Reliability and Available Aircraft Report',
      'Weekly Maintenance Work Order and Completion Status',
      'Monthly Airworthiness and AD Compliance Report',
      'Quarterly Engine Performance and Condition Analysis',
      'Annual Heavy Maintenance Check Forecast',
      'Predictive Maintenance and Component Replacement Schedule',
      'Regulatory Compliance and Audit Readiness Checklist'
    ],
    confidenceRules: [
      'Dispatch data must be verified against flight departure records',
      'AD compliance must be verified with regulatory database',
      'Engine data must be traceable to specific aircraft and engine serial number',
      'Inspection reports must be signed by qualified inspectors',
      'Flight hour data must be reconciled with aircraft flight logs',
      'Maintenance record data must include completion date and certifying mechanic'
    ],
    blockedAutomationRules: [
      'Do not auto-dispatch aircraft with outstanding safety-critical ADs',
      'Do not automatically extend scheduled check intervals',
      'Do not bypass MEL compliance requirements',
      'Do not auto-approve maintenance deferral beyond MEL authority',
      'Do not modify flight hour tracking without cross-reference',
      'Do not disable airworthiness release sign-off requirement'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  marine_shipping: {
    industryCode: 'marine_shipping',
    industryName: 'Marine Shipping',
    description: 'Vessel maintenance, port operations, and shipping fleet management with emphasis on class society rules compliance, dry-dock planning, SOLAS regulations, and vessel availability.',
    primaryMissionObjective: 'Maintain vessel classification and seaworthiness while optimizing fleet utilization and meeting international maritime regulations.',
    commonAssetClasses: [
      'Hull and Structural Components',
      'Marine Propulsion Systems',
      'Steering and Maneuvering Systems',
      'Electrical and Power Distribution',
      'Cargo Handling and Pumping',
      'Life Safety and Emergency Systems',
      'Navigation and Communication Equipment',
      'Environmental Control Systems'
    ],
    onboardingQuestions: [
      'What is your vessel fleet size and average vessel age?',
      'What vessel types do you operate - container, bulk carrier, tanker, general cargo?',
      'What is your planned dry-dock and maintenance schedule (years between overhauls)?',
      'What is your current class society status and any outstanding survey requirements?',
      'How many SOLAS inspection and certification deadlines are pending?',
      'What is your engine and propulsion system maintenance strategy?',
      'Do you operate under flag-state regulations or international standards?',
      'What is your average turnaround time in port for maintenance?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Safety-Environmental-Regulatory-Financial Impact',
      consequenceCategories: [
        'Vessel Immobilization or Detention',
        'Loss of Class or Detention by Port State',
        'Environmental Pollution Event',
        'Structural Failure at Sea',
        'Schedule Disruption'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 18 }
    },
    riskDrivers: [
      'Main engine bearing wear and crankshaft deflection',
      'Hull corrosion and structural thickness loss',
      'Steering gear actuator failure and loss of maneuverability',
      'Electrical switchgear contamination and insulation breakdown',
      'Ballast water system corrosion and tank fracture',
      'SOLAS compliance lapse and regulatory detention'
    ],
    safeguards: [
      'Main engine crankcase monitoring and bearing wear analysis',
      'Hull ultrasonic thickness surveys prior to dry-dock',
      'Steering system functional testing and backup verification',
      'Electrical system insulation resistance testing (annual)',
      'Ballast tank internal inspection and corrosion assessment',
      'SOLAS compliance tracking and survey deadline management'
    ],
    approvalGates: [
      'Dry-dock Schedule Approval - Regulatory and Operational Review',
      'Major Engine Overhaul - Performance and Sea Trial Verification',
      'Class Survey Execution - Classification Society Sign-off',
      'SOLAS Compliance Plan - Regulatory Approval and Timeline',
      'Structural Repair or Renewal - Engineering and Classification Review'
    ],
    failureModeFocusAreas: [
      'Main engine bearing corrosion and white metal spalling',
      'Hull plating corrosion and pitting fatigue',
      'Steering ram rod buckling and loss of control',
      'Electrical cable insulation breakdown and short circuit',
      'Ballast pump seal failure and tank flooding',
      'Propeller hub keyway shearing and propeller slip',
      'SOLAS equipment certification expiration and detention'
    ],
    kpiModel: {
      primaryKpis: [
        'Vessel Availability (%)',
        'Class Society Compliance Status',
        'SOLAS Certification Compliance (%)',
        'Port State Detention Rate',
        'Unscheduled Maintenance Events',
        'Average Dry-dock Interval (years)',
        'Scheduled vs. Actual Maintenance'
      ],
      secondaryKpis: [
        'Main Engine Overhaul Interval (hours)',
        'Hull Thickness Trend (mm/year)',
        'Electrical System Insulation Resistance',
        'Steering System Response Time',
        'Environmental Spill Incidents (count)',
        'Fuel Efficiency vs. Baseline'
      ],
      kpiTargets: {
        'Vessel Availability': '95%+',
        'Class Compliance': '100%',
        'SOLAS Compliance': '100%',
        'Port State Detention': '0%'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Reactive repairs at sea',
        'Managed - Planned maintenance during port calls',
        'Optimized - Predictive maintenance with dry-dock optimization',
        'Autonomous - Autonomous systems with self-optimization'
      ],
      minimumForOperation: 'Managed - Scheduled maintenance per dry-dock intervals and SOLAS requirements',
      minimumForOptimization: 'Optimized - Continuous monitoring with predictive maintenance planning'
    },
    regulatoryConsiderations: [
      'International Maritime Organization (IMO) SOLAS regulations',
      'International Convention for Prevention of Pollution from Ships (MARPOL)',
      'Classification Society rules and survey requirements',
      'Flag state regulations and port state control inspections',
      'International Convention on Load Lines (ICLL)',
      'Maritime Labor Convention (MLC) compliance'
    ],
    dataSourcesRequired: [
      'Main engine monitoring and diagnostic data',
      'Hull thickness survey results and corrosion data',
      'Class society survey reports and recommendations',
      'SOLAS certification tracking and renewal dates',
      'Maintenance and repair records',
      'Environmental spill and incident reports',
      'Port call scheduling and turnaround data'
    ],
    integrationTargets: [
      'Vessel management system (VMS)',
      'Main engine monitoring systems',
      'Hull condition assessment platforms',
      'Class society compliance tracking',
      'Environmental compliance systems',
      'Port scheduling and logistics systems'
    ],
    outputArtifacts: [
      'Monthly Vessel Availability and Utilization Report',
      'Quarterly Hull and Structural Condition Assessment',
      'Semi-Annual Main Engine Overhaul Interval Forecast',
      'Annual Class Society Compliance and Survey Schedule',
      'Annual SOLAS Certification Status and Renewal Plan',
      'Dry-dock Planning and Budget Estimate (5-year)',
      'Port State Control Inspection Readiness Checklist'
    ],
    confidenceRules: [
      'Engine monitoring data must be certified by ship officers',
      'Hull thickness surveys require certified marine surveyor',
      'Class society compliance must be verified with classification database',
      'SOLAS certification must be cross-referenced with IMO registry',
      'Maintenance records must include date, work description, and responsible party',
      'Survey reports must be signed by recognized classification society'
    ],
    blockedAutomationRules: [
      'Do not auto-defer SOLAS compliance deadlines',
      'Do not automatically schedule dry-dock beyond class survey interval',
      'Do not bypass structural inspection requirements',
      'Do not modify environmental pollution prevention protocols',
      'Do not automatically resume sea trial without classification sign-off',
      'Do not disable SOLAS alarm and notification systems'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  data_centers: {
    industryCode: 'data_centers',
    industryName: 'Data Centers',
    description: 'Critical infrastructure data center operations with emphasis on uptime tier compliance, redundancy assurance, thermal management, and uninterruptible power systems.',
    primaryMissionObjective: 'Deliver continuous IT infrastructure services with guaranteed uptime and compliance with tier certifications while maintaining redundancy and thermal stability.',
    commonAssetClasses: [
      'Server and Rack Equipment',
      'Uninterruptible Power Supply (UPS) Systems',
      'Power Distribution Units (PDU)',
      'Cooling Systems and CRAC/CRAH',
      'Fire Suppression and Detection',
      'Physical Security Systems',
      'Network and Switching Equipment',
      'Backup Generator Systems'
    ],
    onboardingQuestions: [
      'What is your target Tier level - Tier III, Tier IV, or hybrid?',
      'What is your current uptime percentage and SLA commitment?',
      'How many MW of IT load capacity do you operate?',
      'What is your power utilization factor and cooling efficiency?',
      'How many independent power feeds and critical UPS modules?',
      'What is your current redundancy factor (N, N+1, 2N)?',
      'Do you operate geographically distributed data centers?',
      'What is your current data center monitoring and alerting system?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Uptime Impact-Power Failure-Cooling Failure-Regulatory',
      consequenceCategories: [
        'Complete Power Failure',
        'Cooling System Failure and Thermal Event',
        'Network Connectivity Loss',
        'Data Loss or Corruption',
        'SLA Non-Compliance and Customer Impact'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 6, high: 12, critical: 18 }
    },
    riskDrivers: [
      'UPS battery degradation and loss of backup power',
      'Utility power distribution failure and outage',
      'Cooling system compressor failure and thermal runaway',
      'Generator fuel supply depletion or carburetor failure',
      'Network switch or router hardware failure',
      'Fire suppression system malfunction and heat damage'
    ],
    safeguards: [
      'UPS battery health monitoring and load testing (quarterly)',
      'Generator load bank testing and fuel integrity verification',
      'Cooling system redundancy with hot-standby operation',
      'Real-time temperature and airflow monitoring',
      'Automatic failover systems for power and network',
      'Fire detection systems with regular functional testing'
    ],
    approvalGates: [
      'Equipment Addition or Replacement - Power and Cooling Capacity Review',
      'Power Infrastructure Change - Redundancy and Tier Compliance Verification',
      'Cooling System Modification - Thermal Model and Capacity Review',
      'UPS or Generator Replacement - Performance and Runtime Verification',
      'Network Equipment Upgrade - Bandwidth and Redundancy Assessment'
    ],
    failureModeFocusAreas: [
      'UPS battery cell degradation and capacity loss',
      'Generator magnetic contactor stiction and failure to start',
      'Cooling chiller condenser tube corrosion and leakage',
      'Power distribution switchgear arc flash and insulation breakdown',
      'Network optical fiber cut or physical damage',
      'Server RAM ECC error increase and memory failure',
      'Fire suppression system agent discharge and accidental trigger'
    ],
    kpiModel: {
      primaryKpis: [
        'Data Center Uptime (%)',
        'Tier Compliance Score (%)',
        'Mean Time to Recovery (MTTR)',
        'Power Utilization Efficiency (PUE)',
        'Cooling Efficiency (COP)',
        'UPS Battery State of Health',
        'Network Packet Loss Rate (%)'
      ],
      secondaryKpis: [
        'Redundancy Factor Verification',
        'Generator Fuel Autonomy (hours)',
        'Room Temperature Stability',
        'Hot Aisle/Cold Aisle Efficiency',
        'Server Error Rate (ECC errors)',
        'Preventive Maintenance Compliance (%)'
      ],
      kpiTargets: {
        'Data Center Uptime': '99.99%+ (Tier III/IV)',
        'PUE': '<1.5',
        'MTTR': '<15 minutes',
        'Network Packet Loss': '0%'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual monitoring, reactive repairs',
        'Managed - Scheduled maintenance, basic redundancy',
        'Optimized - Predictive analytics, integrated redundancy',
        'Autonomous - Autonomous failover and self-healing systems'
      ],
      minimumForOperation: 'Managed - Weekly equipment verification and monthly preventive maintenance',
      minimumForOptimization: 'Optimized - Continuous monitoring with predictive redundancy validation'
    },
    regulatoryConsiderations: [
      'Tier certification (Uptime Institute or equivalent)',
      'ANSI/ASHRAE thermal guidelines compliance',
      'Fire safety and suppression system regulations',
      'Electrical code compliance and arc flash hazard assessment',
      'Environmental and cooling efficiency standards',
      'Data security and access control requirements'
    ],
    dataSourcesRequired: [
      'Real-time power monitoring (voltage, frequency, load)',
      'UPS battery monitoring and health data',
      'Temperature and humidity sensor data',
      'Cooling system performance metrics',
      'Generator runtime and fuel consumption logs',
      'Network performance and packet loss data',
      'Server health and error logs'
    ],
    integrationTargets: [
      'Building management system (BMS)',
      'Power distribution monitoring system',
      'UPS and battery management system',
      'Cooling system SCADA',
      'Network monitoring and performance tools',
      'Server monitoring and health systems'
    ],
    outputArtifacts: [
      'Real-Time Infrastructure Health Dashboard',
      'Daily Uptime and Incident Log',
      'Weekly Redundancy Verification Report',
      'Monthly Power and Cooling Efficiency Analysis',
      'Quarterly UPS Battery Health and Load Test Report',
      'Annual Tier Compliance Certification',
      'Annual Disaster Recovery and Failover Drill Report'
    ],
    confidenceRules: [
      'Uptime metrics must be certified by independent monitoring provider',
      'Power data must be verified through multiple PMU sources',
      'Temperature readings require redundant sensor verification',
      'UPS battery data must reference certified battery analyzer',
      'Network performance must be verified through packet capture analysis',
      'Redundancy verification must include simulated component failure'
    ],
    blockedAutomationRules: [
      'Do not auto-failover without verification of target system readiness',
      'Do not disable redundancy verification monitoring',
      'Do not modify cooling setpoints without thermal analysis',
      'Do not automatically shed server load during peak operations',
      'Do not disable fire suppression system alarms',
      'Do not modify network routing without change control approval'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  defense: {
    industryCode: 'defense',
    industryName: 'Defense',
    description: 'Military equipment sustainment and maintenance operations with emphasis on operational availability, mission-capable rate, and depot-level readiness.',
    primaryMissionObjective: 'Maintain defense equipment and systems at optimal operational readiness to support mission requirements and force deployment.',
    commonAssetClasses: [
      'Combat Vehicles and Tanks',
      'Aircraft and Helicopters',
      'Naval Vessels and Submarines',
      'Weapons Systems and Ammunition',
      'Communications and Electronic Warfare',
      'Logistics and Support Equipment',
      'Maintenance Depots and Facilities',
      'Testing and Calibration Equipment'
    ],
    onboardingQuestions: [
      'What defense platforms do you maintain - vehicles, aircraft, naval, or weapons systems?',
      'How many assets are in your operational inventory?',
      'What is your current mission-capable rate target?',
      'How many depot-level maintenance events are planned annually?',
      'What is your spare parts availability and supply chain status?',
      'What are your most critical failure modes and root causes?',
      'Do you operate under military specifications (MIL-SPEC) or defense standards?',
      'What is your average equipment age and service life remaining?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Mission Impact-Force Readiness-Safety-Equipment Loss',
      consequenceCategories: [
        'Mission Failure or Cancellation',
        'Loss of Force Readiness',
        'Personnel Casualty',
        'Equipment Total Loss',
        'Operational Capability Degradation'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 8, high: 16, critical: 20 }
    },
    riskDrivers: [
      'Component fatigue and structural failure from high utilization',
      'Corrosion and environmental degradation in storage',
      'Spare parts supply disruption and logistics delay',
      'Crew training deficiency and operational error',
      'Power generation or propulsion system failure',
      'Communication equipment malfunction and loss of command'
    ],
    safeguards: [
      'Predictive maintenance using advanced diagnostics',
      'Environmental storage monitoring and corrosion prevention',
      'Spare parts pre-positioning and supply chain resilience',
      'Crew training and qualification verification',
      'Redundant power and communication systems',
      'Regular operational readiness inspections'
    ],
    approvalGates: [
      'Major Overhaul Execution - Readiness Impact and Timeline Approval',
      'Equipment Modification or Upgrade - Operational and Safety Assessment',
      'Spare Parts Procurement - Supply and Budget Authorization',
      'Crew Training Program - Qualification and Certification',
      'Storage and Environmental Control Plan - Corrosion Prevention Review'
    ],
    failureModeFocusAreas: [
      'Combat vehicle drivetrain fatigue and transmission failure',
      'Aircraft airframe structural crack propagation',
      'Naval propulsion turbine blade erosion and power loss',
      'Weapons system electrical connector corrosion',
      'Communications antenna environmental corrosion',
      'Hydraulic system seal degradation and pressure loss',
      'Fuel system contamination and engine performance degradation'
    ],
    kpiModel: {
      primaryKpis: [
        'Mission-Capable Rate (MCR %)',
        'Operational Availability (%)',
        'Mean Time Between Failures (MTBF)',
        'Mean Time to Repair (MTTR)',
        'Spare Parts Availability (%)',
        'Preventive Maintenance Compliance (%)',
        'Depot Maintenance Backlog (units)'
      ],
      secondaryKpis: [
        'Force Deployment Readiness Score',
        'Equipment Age and Service Life Utilization',
        'Materiel Reliability Trend',
        'Logistics Response Time',
        'Crew Qualification Rate (%)',
        'Environmental Storage Condition Score'
      ],
      kpiTargets: {
        'Mission-Capable Rate': '90%+',
        'Availability': '85%+',
        'MTBF': 'System-dependent targets',
        'Spare Parts Availability': '95%+'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Maintenance-on-failure, limited monitoring',
        'Managed - Scheduled preventive maintenance program',
        'Optimized - Predictive maintenance with advanced diagnostics',
        'Autonomous - Autonomous systems with self-optimization'
      ],
      minimumForOperation: 'Managed - Scheduled maintenance per military maintenance schedules',
      minimumForOptimization: 'Optimized - Predictive analytics with continuous monitoring'
    },
    regulatoryConsiderations: [
      'Military Specifications (MIL-SPEC) and standards compliance',
      'Defense Acquisition Regulation Supplement (DFARS) requirements',
      'Weapons system certification and approval processes',
      'Environmental storage and handling regulations',
      'Supply chain cybersecurity and materiel integrity',
      'Safety and occupational health standards for military personnel'
    ],
    dataSourcesRequired: [
      'Equipment maintenance records and service logs',
      'Operational readiness status and deployment schedules',
      'Spare parts inventory and requisition data',
      'Environmental monitoring and storage condition data',
      'Crew training and qualification records',
      'Equipment failure and incident reports',
      'Supply chain and logistics performance data'
    ],
    integrationTargets: [
      'Military maintenance management systems',
      'Equipment health and diagnostics systems',
      'Supply chain and logistics platforms',
      'Training and qualification management systems',
      'Environmental monitoring systems',
      'Operational readiness reporting systems'
    ],
    outputArtifacts: [
      'Daily Mission-Capable Rate and Availability Report',
      'Weekly Maintenance Backlog and Schedule',
      'Monthly Equipment Reliability and Failure Analysis',
      'Quarterly Spare Parts Inventory and Forecast',
      'Annual Depot Maintenance Plan and Budget',
      'Annual Force Readiness and Deployment Assessment',
      'Annual Environmental Storage Condition and Corrosion Report'
    ],
    confidenceRules: [
      'Mission-capable rate must be verified through command-level reports',
      'Maintenance records must reference military maintenance schedules',
      'Equipment status must be cross-referenced with deployment orders',
      'Spare parts data must include supplier certification',
      'Crew qualification must be verified through training records',
      'Environmental data must be logged through facility monitoring systems'
    ],
    blockedAutomationRules: [
      'Do not auto-deploy equipment without mission-readiness verification',
      'Do not bypass weapons system safety certifications',
      'Do not automatically defer critical maintenance',
      'Do not modify crew training requirements',
      'Do not disable environmental storage alarms',
      'Do not automatically decrease spare parts inventory below minimum'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  },

  aerospace_launch: {
    industryCode: 'aerospace_launch',
    industryName: 'Aerospace & Launch',
    description: 'Launch vehicle and satellite operations with emphasis on countdown readiness, launch commit criteria, and mission assurance for space operations.',
    primaryMissionObjective: 'Achieve reliable and repeatable launch operations while maintaining mission assurance, safety, and compliance with aerospace regulations.',
    commonAssetClasses: [
      'Launch Vehicle Structures and Engines',
      'Propellant Systems and Tanks',
      'Avionics and Flight Control Systems',
      'Ground Support Equipment (GSE)',
      'Launch Pad and Facility Infrastructure',
      'Payload Integration and Separation Systems',
      'Environmental Control and Life Support',
      'Range Safety and Telemetry Systems'
    ],
    onboardingQuestions: [
      'What launch vehicle family do you operate - small/medium/heavy lift?',
      'What is your target launch cadence (launches per year)?',
      'How many vehicles are in your operational inventory?',
      'What are your current launch success rate and mission success rate?',
      'How many launch abort scenarios or hold points are in your procedures?',
      'What is your ground processing timeline and launch pad availability?',
      'Do you operate multiple launch sites or a single facility?',
      'What are your critical mission assurance failure modes?'
    ],
    criticalityModel: {
      riskMatrix: '5x5 Launch Success-Payload Safety-Environmental-Regulatory',
      consequenceCategories: [
        'Launch Failure or Loss of Vehicle',
        'Loss of Mission or Payload',
        'Range Safety Event or Debris Field',
        'Schedule Slip or Launch Delay',
        'Regulatory Non-Compliance'
      ],
      likelihoodScale: 'Remote-Unlikely-Possible-Likely-Very Likely',
      criticalityThresholds: { low: 2, medium: 8, high: 16, critical: 20 }
    },
    riskDrivers: [
      'Engine combustion instability and thrust oscillations',
      'Propellant system pressure regulator failure and flow loss',
      'Avionics sensor degradation and guidance system error',
      'Ground support equipment malfunction during countdown',
      'Structural failure from flight loads or thermal stress',
      'Range safety system component failure and loss of abort capability'
    ],
    safeguards: [
      'Engine hotfire testing before vehicle stacking',
      'Propellant system pressurization and flow testing',
      'Flight control system validation and redundancy verification',
      'Ground support equipment functional testing',
      'Structural stress analysis and load verification',
      'Range safety system automated testing and override prevention'
    ],
    approvalGates: [
      'Vehicle Assembly and Stacking - Structural and Avionics Review',
      'Propellant Loading - System Pressure and Fill Verification',
      'Pre-Launch Checkout - Countdown Readiness Review',
      'Launch Commit Criteria Assessment - Weather and Range Safety',
      'Post-Flight Analysis - Mission Success and Vehicle Reusability Review'
    ],
    failureModeFocusAreas: [
      'Engine combustion chamber wall erosion and hot spots',
      'Propellant pump cavitation and flow rate degradation',
      'Guidance system inertial measurement unit (IMU) bias drift',
      'Avionics memory upset and software fault',
      'Stage separation system latch mechanism stiction',
      'Payload fairing separation system failure',
      'Engine shut-down valve failure to close and thrust loss'
    ],
    kpiModel: {
      primaryKpis: [
        'Launch Success Rate (%)',
        'Mission Success Rate (%)',
        'Launch Availability (%)',
        'Mean Time Between Launches (MTBL)',
        'Countdown Hold and Abort Frequency',
        'Payload Performance Success (%)',
        'Range Safety Compliance (zero incidents)'
      ],
      secondaryKpis: [
        'Ground Processing Time (days)',
        'Propellant Utilization Efficiency',
        'Vehicle Reusability Rate (for reusable platforms)',
        'Avionics System Reliability',
        'Ground Support Equipment Availability',
        'Maintenance Turnaround Time (between missions)'
      ],
      kpiTargets: {
        'Launch Success Rate': '95%+',
        'Mission Success Rate': '95%+',
        'Launch Availability': '90%+',
        'Range Safety Incidents': '0'
      }
    },
    readinessModel: {
      readinessLevels: [
        'Ad-hoc - Manual checkout procedures, reactive troubleshooting',
        'Managed - Automated checkout sequences with scheduled inspections',
        'Optimized - Predictive diagnostics with integrated systems health',
        'Autonomous - Autonomous system verification and validation'
      ],
      minimumForOperation: 'Managed - Pre-flight checkout per flight readiness review requirements',
      minimumForOptimization: 'Optimized - Integrated systems health with automated anomaly detection'
    },
    regulatoryConsiderations: [
      'Federal Aviation Administration (FAA) Commercial Space Transportation licensing',
      'Range Safety Requirements and Impact Footprint Compliance',
      'Environmental Impact Assessment and Noise/Vibration Compliance',
      'Payload Licensing and Orbital Mechanics Approval',
      'Insurance and Liability Requirements',
      'International Treaties (Outer Space Treaty, Registration Convention)'
    ],
    dataSourcesRequired: [
      'Vehicle and avionics telemetry and flight data',
      'Engine performance data from test stands and flight',
      'Propellant system pressure and flow logs',
      'Ground support equipment functional test data',
      'Weather and range condition data at launch time',
      'Launch vehicle structural analysis and stress data',
      'Range safety system and abort scenario testing'
    ],
    integrationTargets: [
      'Launch vehicle flight control system',
      'Ground checkout and test automation systems',
      'Propellant management and flow control systems',
      'Range safety and telemetry systems',
      'Mission planning and trajectory analysis',
      'Vehicle health monitoring and diagnostics systems'
    ],
    outputArtifacts: [
      'Pre-Flight Readiness Review and Checkout Report',
      'Countdown Timeline and Hold Point Summary',
      'Launch Commit Criteria Assessment and Weather Analysis',
      'Flight Performance and Telemetry Analysis Report',
      'Post-Flight Vehicle Condition and Reusability Assessment',
      'Mission Success Analysis and Lessons Learned',
      'Range Safety and Emergency Abort System Verification'
    ],
    confidenceRules: [
      'Flight data must be verified through certified telemetry',
      'Engine performance must reference ground test baseline',
      'Propellant data must be logged through real-time sensors',
      'Avionics accuracy must be verified through pre-flight calibration',
      'Weather data must be from official range meteorologist',
      'Range safety compliance must be certified by range commander'
    ],
    blockedAutomationRules: [
      'Do not auto-proceed with launch countdown if any abort criterion is met',
      'Do not bypass range safety verification and review',
      'Do not automatically override launch commit decision',
      'Do not modify propellant flow parameters during countdown',
      'Do not disable vehicle telemetry or command uplink systems',
      'Do not automatically restart countdown after substantive hold'
    ],
    templateVersion: '1.0.0',
    validationStatus: 'customer_validated'
  }
};

export function getIndustryTemplatePack(industryCode: string): IndustryTemplatePack | undefined {
  return INDUSTRY_TEMPLATE_PACKS[industryCode];
}

export function listIndustryTemplatePacks(): IndustryTemplatePack[] {
  return Object.values(INDUSTRY_TEMPLATE_PACKS);
}
